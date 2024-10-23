import { IncyclistService } from "../../base/service";
import { Singleton } from "../../base/types";
import { useUserSettings } from "../../settings";
import { ActivityDetails } from "../base";
import crypto from 'crypto'
import { IActivityUpload, VeloHeroAuth } from "./types";
import { valid } from "../../utils/valid";
import { VeloHeroApi } from "../../apps/base/api";



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
                this.logger.logEvent( {message:'VeloHero init done', hasCredentials:true})
            
            }
            this.isInitialized = true;           

        }
        catch(err) {
            this.logger.logEvent({message:'error', error:err.message, fn:'init',stack:err.stack})
            this.isInitialized = false;
        }

        this.on('login-start',()=>{this._isConnecting = true})
        this.on('login-success',()=>{this._isConnecting = false})
        this.on('login-failure',()=>{this._isConnecting = false})
    
        return this.isInitialized
    }

    isConnected():boolean {
        this.ensureInitialized()
        return (valid(this.username) && valid(this.password))
    }

    isConnecting():boolean {
        return this._isConnecting;
    }

    async login(username:string,password:string):Promise<boolean> {
        this.ensureInitialized()

        this.logger.logEvent({message:'VeloHero Login'})

        this.emit('login-start')

        try {
            await this.getApi().login(username,password)

            this.logger.logEvent({message:'VeloHero Login success'})

            this.username = username;
            this.password = password
            this.isInitialized = true;
            
            const auth = await this.saveCredentials()
            this.emit('login-success', auth)

            return true
            
        }
        catch(err) {
            this.logger.logEvent({message:'VeloHero Login failed',error: err.message})
            this.emit('login-failure')
            throw err
        }



    }

    disconnect():void {
        this.username =undefined
        this.password = undefined
        this.getUserSettings().set('user.auth.velohero',null)   
    }

    protected ensureInitialized() {
        if (!this.isInitialized)
            this.init()
        return this.isInitialized
    }


    async upload(activity: ActivityDetails, format:string='TCX'):Promise<boolean> {
        try {
            
            const ok =this.ensureInitialized()
            if (!ok) {
                this.logger.logEvent({message:'VeloHero Upload skipped', reason:'not initialized'})

                return false;
            }
            
            this.logger.logEvent({message:'VeloHero Upload', format})

            const username = this.username
            const password = this.password
            const fileName =  activity[`${format}FileName`];
            await this.getApi().upload(fileName,{username,password})
            this.logger.logEvent({message:'VeloHero Upload success'})
            return true;

        }
        catch(err) {
            this.logger.logEvent({message:'VeloHero Upload failure', error: err.message})
            return false

        }
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
            this.logger.logEvent( {message: 'error', fn:'saveCredentials', error:err.message, stack:err.stack})
        }

        this.logger.logEvent({message:'VeloHero Save Credentials done'})
        return auth

    }

    protected encrypt():VeloHeroAuth {
        const iv = crypto.randomBytes(16)

        const uuid = this.getUuid()
        const key = `${uuid.substring(0,32)}`
        
        const cipher = crypto.createCipheriv('AES-256-CCM',key,iv);
        
        const text = JSON.stringify({username:this.username, password:this.password})


        let ciphered = cipher.update(text, 'utf8', 'hex');        
        ciphered += cipher.final('hex');
        const auth =  {
            id: iv.toString('hex'),
            authKey: ciphered
        }

        return auth
    }

    protected decrypt(auth:VeloHeroAuth) {

        const {id,authKey} = auth

        const iv = Buffer.from(id,'hex')
        const uuid = this.getUuid()
        const key = `${uuid.substring(0,32)}`


        const decipher = (em) => {
            try {
                const cipher = crypto.createDecipheriv(em,key,iv);

                let text = cipher.update(authKey, 'hex','utf8');
                text += cipher.final('utf8');
                const user = JSON.parse(text)                        
                return user
            }
            catch(err) {
                // istanbul ignore next
            }
    
        }

        let user 
        
        user = decipher('AES-256-CCM')
        if (!user) {
            user = decipher('aes256')
        }


        return user
    }


    // istanbul ignore next
    protected getUserSettings() {
        return useUserSettings()
    }

    protected getApi() {
        if (!this.api)
            this.api = new VeloHeroApi()
        return this.api
    }

    
}