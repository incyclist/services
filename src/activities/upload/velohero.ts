import { IncyclistService } from "../../base/service";
import { Singleton } from "../../base/types";
import { useUserSettings } from "../../settings";
import { ActivityDetails } from "../base";
import crypto from 'crypto'
import { IActivityUpload, VeloHeroAuth } from "./types";
import { valid } from "../../utils/valid";
import { VeloHeroApi } from "../../apps/base/api";
import { deprecate } from "util";



/**
 * Service for uploading activities to VeloHero.
 */
@Singleton
export class VeloHeroUpload extends IncyclistService implements IActivityUpload{

    protected isInitialized
    protected username
    protected password
    protected api: VeloHeroApi
    protected _isConnecting

    constructor() {
        super('VeloHeroUpload')
        this.isInitialized = false

        this.init()
    }

    /**
     * Initializes the VeloHero service
     * 
     * It will try to load the credentials from the user settings and setups event listeners
     * 
     * @returns true if the initialization is successful
     */
    init():boolean {

        if (this.isInitialized)
            return true

        if (!this.getUserSettings().isInitialized) {
            return false
        }

        try {
            const auth = this.getCredentials()

            if (auth) {
            
                if (auth.username && auth.password) {
                    this.username = auth.username
                    this.password = auth.password    

                }
                else {            
                    const user = this.decrypt(auth)
                    this.username = user.username;
                    this.password = user.password
                }   
            
            }

            this.logEvent( {message:'VeloHero init done', hasCredentials:(valid(this.username)&& valid(this.password))})
            this.isInitialized = true;           

        }
        catch(err) {
            this.logEvent({message:'error', error:err.message, fn:'init',stack:err.stack})
            this.isInitialized = false;
        }

        this.setupEventListeners()

    
        return this.isInitialized
    }

    /**
     * Checks if the connection is established by ensuring the initialization
     * process is complete and validating the presence of username and password.
     *
     * @returns {boolean} True if both username and password are valid, false otherwise.
     */
    isConnected():boolean {
        this.ensureInitialized()
        return (valid(this.username) && valid(this.password))
    }

    /**
     * Indicates whether the login process is currently running.
     * @returns {boolean} True if login is in progress, false otherwise.
     */
    isConnecting():boolean {
        return this._isConnecting;
    }

    async login(username:string,password:string):Promise<boolean> {
        this.ensureInitialized()

        this.logEvent({message:'VeloHero Login'})

        this.emit('login-start')

        try {
            await this.getApi().login(username,password)

            this.logEvent({message:'VeloHero Login success'})

            this.username = username;
            this.password = password
            this.isInitialized = true;
            
            const auth = await this.saveCredentials()
            this.emit('login-success', auth)

            return true
            
        }
        catch(err) {
            this.logEvent({message:'VeloHero Login failed',error: err.message})
            this.emit('login-failure',err.message)
            throw err
        }



    }

    /**
     * Disconnects from VeloHero by deleting the stored credentials.
     */
    disconnect():void {
        this.username =undefined
        this.password = undefined
        this.getUserSettings().set('user.auth.velohero',null)           
    }

    /**
     * Uploads the activity to VeloHero.
     * 
     * It will not attempt to upload the file and populate the links property in the activity with information of the uploaded file
     * The links property will be populated with the activity_id and the url and with an error if the upload failed
     * 
     * If the user has not connected with VeloHero this will be skipped (not logged)
     * If the upload is attempted on a non initialized service this will be skipped (and logged)
     * 
     * 
     * @param {ActivityDetails} activity - The activity to upload.
     * @param {string} [format='TCX'] - The format of the activity. 
     * @returns {Promise<boolean>} Indicates if the upload was successful.
     */
    async upload(activity: ActivityDetails, format:string='TCX'):Promise<boolean> {
        try {
            
            const ok =this.ensureInitialized()
            if (!ok) {
                this.logEvent({message:'VeloHero Upload skipped', reason:'not initialized'})

                return false;
            }

            if (!this.isConnected()) {
                return false
            }

            const lcFormat = format.toLowerCase()
            const ucFormat = format.toUpperCase()
            this.logEvent({message:'VeloHero Upload', format:ucFormat})

            if (!activity.links)
                activity.links  = {}


            const username = this.username
            const password = this.password
            const fileName =  activity[`${lcFormat}FileName`];
            const res = await this.getApi().upload(fileName,{username,password})

            this.logEvent({message:'VeloHero Upload success',...res})
            
            activity.links.velohero = {
                activity_id: res.id,
                url: res['url-show']??this.getUrl(res.id)
            }

            return true;

        }
        catch(err) {
            this.logEvent({message:'VeloHero Upload failure', error: err.message})
            activity.links.velohero = {
                error: err.message
            }
            return false

        }
    }

    /**
     * Constructs the URL for a VeloHero workout based on the provided ID.
     *
     * @param {string} id - The unique identifier of the workout.
     * @returns {string} The URL for viewing the workout on VeloHero.
     */
    getUrl(id: string): string {
        return `https://app.velohero.com/workouts/show/${id}`
    }


    protected ensureInitialized() {
        if (!this.isInitialized)
            this.init()
        return this.isInitialized
    }

    protected getUuid() {
        const userSettings = this.getUserSettings()
        try {
            const uuid = userSettings.get('uuid',null)
            return uuid;
        }
        catch{
            return null
        }
    }

    protected getCredentials() {
        const userSettings = this.getUserSettings()
        try {
            return userSettings.get('user.auth.velohero',null)        
        }
        catch {
            return null
        }
    }

    protected saveCredentials() {
        this.logger.logEvent({message:'VeloHero Save Credentials'})

        let auth
        try {
            auth = this.encrypt();
            this.getUserSettings().set('user.auth.velohero',auth)

        }
        catch(err) {
            this.logEvent( {message: 'error', fn:'saveCredentials', error:err.message, stack:err.stack})
        }

        this.logEvent({message:'VeloHero Save Credentials done'})
        return auth

    }

    protected encrypt():VeloHeroAuth {
        const iv = crypto.randomBytes(16)
        
        const uuid = this.getUuid()
        const key = `${uuid.substring(0,32)}`
        
        const cipher = crypto.createCipheriv('aes-256-gcm',key,iv);
        
        const text = JSON.stringify({username:this.username, password:this.password})

        let ciphered

        ciphered = (Buffer.concat(
            [cipher.update(text), cipher.final(), cipher.getAuthTag()])).toString("hex"); // Alternatively, base64 also works

        const auth =  {
            id: iv.toString('hex'),
            authKey: ciphered,
            version:'2'
        }

        return auth
    }

    /**
    @deprecate
     **/
    protected encryptLegacy(algo):VeloHeroAuth {
        const iv = crypto.randomBytes(16)
        
        const uuid = this.getUuid()
        const key = `${uuid.substring(0,32)}`
        
        const cipher = crypto.createCipheriv(algo,key,iv);
        
        const text = JSON.stringify({username:this.username, password:this.password})

        let ciphered



        ciphered = cipher.update(text, 'utf8', 'hex');        
        ciphered += cipher.final('hex');

        const auth =  {
            id: iv.toString('hex'),
            authKey: ciphered,
        }

        return auth
    }


    protected decrypt(auth:VeloHeroAuth) {

        const {id,authKey,version} = auth

        const iv = Buffer.from(id,'hex')
        const uuid = this.getUuid()
        const key = `${uuid.substring(0,32)}`


        const decipher = (em,props?) => {
            try {
                
                const cipher = crypto.createDecipheriv(em,key,iv,props);


                let text;

                if (em==='aes-256-gcm') {
                    const raw = Buffer.from(authKey, "hex"); 

                    const authTagBuff = raw.subarray(raw.length - 16); // Returns a new Buffer that references the same memory as the original, but offset and cropped by the start and end indices.
                    const encTextBuff = raw.subarray(0, raw.length - 16); // Returns a new Buffer that references the same memory as the original, but offset and cropped by the start and end indices.
            
                    cipher.setAuthTag(authTagBuff);
            
                    // Decrypting
                    text = cipher.update(encTextBuff);
                    text += cipher.final('utf8');
                }
                else {
                    text = cipher.update(authKey, 'hex','utf8');                
                    text += cipher.final('utf8');    
                }
                
                const user = JSON.parse(text)                        
                return user
            }
            catch(err) {
                // istanbul ignore next
            }
    
        }

         
        
        if (version==='2')
            return decipher('aes-256-gcm')
        
        return decipher('AES-256-CCM')?? decipher('aes256')

    }

    protected setupEventListeners() {
        this.on('login-start',()=>{this._isConnecting = true})
        this.on('login-success',()=>{this._isConnecting = false})
        this.on('login-failure',()=>{this._isConnecting = false})

    }


    // istanbul ignore next
    protected getUserSettings() {
        return this.injected['UserSettings'] ?? useUserSettings()
    }

    // istanbul ignore next
    protected getApi() {

        if (this.injected['Api'])
            return this.injected['Api']

        if (!this.api)
            this.api = new VeloHeroApi()
        return this.api
    }

    
}