import { getBindings, ICryptoBinding } from "../../api";
import { Injectable, Singleton } from "../../base/decorators";
import { valid } from "../../utils/valid";
import { VeloHeroApi } from "../base/api";
import { ConnectedAppService } from "../base/app";
import { VeloHeroAuth, VeloHeroCredentials } from "./types";

const CRYPT_ALGO = 'aes256'

@Singleton
export class VeloHeroAppConnection extends ConnectedAppService<VeloHeroCredentials> {
    protected _isConnecting
    protected api: VeloHeroApi
    protected credentials: VeloHeroCredentials

    constructor() {
        super('VeloHeroAppConnection','velohero')
    }

    async connect( credentials:VeloHeroCredentials):Promise<boolean> {
        this.ensureInitialized()

        this.logEvent({message:'VeloHero Login'})
        this.emit('login-start')
        try {
            const {username,password} = credentials
            await this.getApi().login(username,password)

            this.logEvent({message:'VeloHero Login success'})

            this.credentials = credentials            
            this.isInitialized = true;
            
            const auth = this.saveCredentials()
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
     * Indicates whether the login process is currently running.
     * @returns {boolean} True if login is in progress, false otherwise.
     */
    isConnecting():boolean {
        return this._isConnecting===true;
    }

    /**
     * Disconnects from VeloHero by deleting the stored credentials.
     */
    disconnect():void {
        this.credentials =undefined        
        this.getUserSettings().set('user.auth.velohero',null)           
    }

    /**
     * Checks if the connection is established by ensuring the initialization
     * process is complete and validating the presence of username and password.
     *
     * @returns {boolean} True if both username and password are valid, false otherwise.
     */
    isConnected():boolean {
        this.ensureInitialized()
        return (valid(this.credentials?.username) && valid(this.credentials?.password))
    }

    getCredentials():VeloHeroCredentials {
        return this.credentials
    }

    getApi() {
        if (!this.api)
            this.api = new VeloHeroApi()
        return this.api
    }


    protected initAuth():boolean {
        let isInitialized = false;

        if (!this.getUserSettings().isInitialized) {
            return false
        }

        try {
            const auth = this.getAuthConfig()

            if (auth) {
            
                // legacy - was containing username an password in clear text
                if (auth['username'] && auth['password']) {
                    this.credentials = auth as VeloHeroCredentials
                }
                else {            
                    this.credentials = this.decrypt(CRYPT_ALGO,auth as VeloHeroAuth)
                }   
            
            }
            this.logEvent( {message:'VeloHero init done', hasCredentials:(valid(this.credentials?.username)&& valid(this.credentials?.password))})
            isInitialized = true;           

        }
        catch(err) {
            this.logEvent({message:'error', error:err.message, fn:'init',stack:err.stack})
            isInitialized = false;
        }

        this.setupEventListeners()

    
        return isInitialized


    }

    protected getAuthConfig():VeloHeroAuth|VeloHeroCredentials {
        const userSettings = this.getUserSettings()
        try {
            return userSettings.get('user.auth.velohero',null)        
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
        this.logger.logEvent({message:'VeloHero Save Credentials'})

        let auth
        try {
            auth = this.encrypt(CRYPT_ALGO);
            this.getUserSettings().set('user.auth.velohero',auth)

        }
        catch(err) {
            this.logEvent( {message: 'error', fn:'saveCredentials', error:err.message, stack:err.stack})
        }

        this.logEvent({message:'VeloHero Save Credentials done'})
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

        // if (getBindings().crypto)
        //     return getBindings().crypto

        // const crypto = require('crypto') as ICryptoBinding
        // return crypto

        return getBindings().crypto??require('crypto')
    }


    protected encrypt(algo:string):VeloHeroAuth {

        if (!this.credentials)
            return null;

        const crypto = this.getCrypto()
        const iv = crypto.randomBytes(16)
        
        const uuid = this.getUuid()
        //const key = `${uuid.substring(0,32)}`
        const key = Buffer.from(uuid.substring(0, 32), 'utf8');
        
        const cipher = crypto.createCipheriv(algo,key,iv);
        
        const {username,password} = this.credentials
        const text = JSON.stringify({username,password})
        let ciphered

        ciphered = cipher.update(text, 'utf8', 'hex');        
        ciphered += cipher.final().toString('hex');

        const auth =  {
            id: iv.toString('hex'),
            authKey: ciphered,
        }

        return auth
    }


    protected decrypt(algo:string, auth:VeloHeroAuth):VeloHeroCredentials {
        if (!auth)
            return null;

        const {id,authKey} = auth

        const iv = Buffer.from(id,'hex')
        const uuid = this.getUuid()
        //const key = `${uuid.substring(0,32)}`
        const key = Buffer.from(uuid.substring(0, 32), 'utf8');
        const crypto = this.getCrypto()

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
                text += cipher.final().toString('utf8');
            }
            else {
                const cipher = crypto.createDecipheriv(algo,key,iv);
                text = cipher.update(authKey, 'hex','utf8');                
                text += cipher.final().toString('utf8');    
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