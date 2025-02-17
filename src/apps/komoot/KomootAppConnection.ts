import { getBindings } from "../../api";
import { Injectable, Singleton } from "../../base/decorators";
import { valid } from "../../utils/valid";
import crypto from 'crypto'
import { KomootApi } from "../base/api";
import { ConnectedAppService } from "../base/app";
import { KomootAuth, KomootCredentials } from "./types";

const CRYPT_ALGO = 'aes256'

@Singleton
export class KomootAppConnection extends ConnectedAppService<KomootCredentials> {
    protected _isConnecting
    protected api: KomootApi
    protected credentials: KomootCredentials

    constructor() {
        super('KomootAppConnection','komoot')
    }

    async connect( credentials:KomootCredentials):Promise<boolean> {
        this.ensureInitialized()

        this.logEvent({message:'Komoot Login'})
        this.emit('login-start')
        try {
            const {username,password,userid} = credentials
            const { authenticated, error}  = await this.getApi().login(username,password,userid)

            if (authenticated) {
                this.logEvent({message:'Komoot Login success'})

                this.credentials = credentials            
                this.isInitialized = true;
                
                const auth = await this.saveCredentials()
                this.emit('login-success', auth)
                return true           
    
            }
            else {
                throw new Error(error)
            }
        }
        catch(err) {
            this.logEvent({message:'Komoot Login failed',error: err.message})
            this.emit('login-failure',err.message)
            throw err
        }
    }

    /**
     * Indicates whether the login process is currently running.
     * @returns {boolean} True if login is in progress, false otherwise.
     */
    isConnecting():boolean {
        return this._isConnecting;
    }

    /**
     * Disconnects from Komoot by deleting the stored credentials.
     */
    disconnect():void {
        this.credentials =undefined        
        this.getUserSettings().set('user.auth.komoot',null)           
    }

    /**
     * Checks if the connection is established by ensuring the initialization
     * process is complete and validating the presence of username and password.
     *
     * @returns {boolean} True if both username and password are valid, false otherwise.
     */
    isConnected():boolean {
        this.ensureInitialized()

        const connected =  (valid(this.credentials?.username) && valid(this.credentials?.password))

        return connected

    }

    getCredentials():KomootCredentials {
        return this.credentials
    }

    getApi() {
        if (!this.api)
            this.api = new KomootApi()
        return this.api
    }


    protected initAuth():boolean {
        let isInitialized = false;
        let credentials;

        if (!this.getUserSettings().isInitialized) {
            return false
        }

        try {
            const auth = this.getAuthConfig()

            if (auth) {
            
                // legacy - was containing username an password in clear text
                if (auth['username'] && auth['password']) {
                    credentials = auth as KomootCredentials
                }
                else {            
                    credentials = this.decrypt(CRYPT_ALGO,auth as KomootAuth)
                }   
                
            
            }
            this.logEvent( {message:'Komoot init done', hasCredentials:(valid(this.credentials?.username)&& valid(this.credentials?.password))})
            isInitialized = true;           

        }
        catch(err) {
            this.logEvent({message:'error', error:err.message, fn:'init',stack:err.stack})
            isInitialized = false;
        }

        this.setupEventListeners()
        this.credentials = credentials

        if (credentials) {
            this.getApi().setAuth(credentials)
        }
   
        return isInitialized


    }

    protected getAuthConfig():KomootAuth|KomootCredentials {
        const userSettings = this.getUserSettings()
        try {
            return userSettings.get('user.auth.komoot',null)        
        }
        catch {
            return null
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

    protected saveCredentials():void {
        this.logger.logEvent({message:'Komoot Save Credentials'})

        let auth
        try {
            auth = this.encrypt(CRYPT_ALGO);
            this.getUserSettings().set('user.auth.komoot',auth)

        }
        catch(err) {
            this.logEvent( {message: 'error', fn:'saveCredentials', error:err.message, stack:err.stack})
        }

        this.logEvent({message:'Komoot Save Credentials done'})
        return auth
    }



    protected getSecret(key:string):string {
        return this.getSecretBindings()?.getSecret(key)
    }

    protected setupEventListeners():void {
        this.on('login-start',()=>{this._isConnecting = true})
        this.on('login-success',()=>{this._isConnecting = false})
        this.on('login-failure',()=>{this._isConnecting = false})

    }

    // istanbul ignore next
    protected getCrypto() {        
        return this.injected['Crypto']?? crypto        
    }


    protected encrypt(algo:string):KomootAuth {

        if (!this.credentials)
            return null;

        const iv = crypto.randomBytes(16)
        
        const uuid = this.getUuid()
        const key = `${uuid.substring(0,32)}`
        
        const cipher = crypto.createCipheriv(algo,key,iv);
        
        const {username,password,userid} = this.credentials
        const text = JSON.stringify({username,password,userid})
        let ciphered

        ciphered = cipher.update(text, 'utf8', 'hex');        
        ciphered += cipher.final('hex');

        const auth =  {
            id: iv.toString('hex'),
            authKey: ciphered,
        }

        return auth
    }


    protected decrypt(algo:string, auth:KomootAuth):KomootCredentials {
        if (!auth)
            return null;

        const {id,authKey} = auth

        const iv = Buffer.from(id,'hex')
        const uuid = this.getUuid()
        const key = `${uuid.substring(0,32)}`

        try {
            
            let text;

            if (algo==='aes-256-gcm') {
                const cipher = crypto.createDecipheriv(algo,key,iv);
                const raw = Buffer.from(authKey, "hex"); 

                const authTagBuff = raw.subarray(raw.length - 16); // Returns a new Buffer that references the same memory as the original, but offset and cropped by the start and end indices.
                const encTextBuff = raw.subarray(0, raw.length - 16); // Returns a new Buffer that references the same memory as the original, but offset and cropped by the start and end indices.
        
                cipher.setAuthTag(authTagBuff);
        
                // Decrypting
                text = cipher.update(encTextBuff);
                text += cipher.final('utf8');
            }
            else {
                const cipher = crypto.createDecipheriv(algo,key,iv);
                text = cipher.update(authKey, 'hex','utf8');                
                text += cipher.final('utf8');    
            }
            
            const credentials = JSON.parse(text)                        
            return credentials
        }
        catch(err) {
            // istanbul ignore next
            this.logError(err,'decrypt',{algo,id,authKey})
            return null
        }

    }    

    @Injectable
    // istanbul ignore next
    protected getSecretBindings() {
        return getBindings()?.secret
    }



}