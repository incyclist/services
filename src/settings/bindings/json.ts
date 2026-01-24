/* eslint-disable @typescript-eslint/no-explicit-any */
import { UserSettingsBinding } from "./types";
import fs from 'fs/promises'

const DEFAULT_PATH = './settings.json'

export default class JSONFileBindig extends UserSettingsBinding{
    protected static _instance: UserSettingsBinding;
    path: string
    settings: any
    savePromise: Promise<boolean> | null
    

    static getInstance(path?:string): UserSettingsBinding {        
        JSONFileBindig._instance = JSONFileBindig._instance ??new JSONFileBindig(path)
        return JSONFileBindig._instance
    }

    constructor(path:string=DEFAULT_PATH) {
        super()
        this.path=path;
        this.savePromise = null;
    }
    
    async getAll(): Promise<any> {
        const settings = await fs.readFile(this.path)
        const valid = this.verify(settings)
        if (!valid)
            throw new Error('invalid JSON object')
        return this.settings
    }

    async set(key:string,value:any):Promise<boolean> {
        if (value===null) {
            delete this.settings[key]
        }
        else if (Array.isArray(value)) {
            this.settings[key] = [...value]
            
        }
        else if (typeof(value)==='object') {
            this.settings[key] = {...value};
        }
        else {
            this.settings[key] = value;
        }

        try {
            await this.save()
            return true
        }
        catch {
            return false
        }

    }

    canOverwrite(): boolean {
        return true
    }

    async save(settings?:any):Promise<boolean> {
        if (settings) {
            this.verify(settings)
            this.settings = settings;
        }

        if (this.savePromise) {// save is busy
            await this.waitForSaveFinished()
        }

        this.savePromise = this.save(JSON.stringify(this.settings,null,2))
        try {
            await this.savePromise;
            this.savePromise = null
            return true;

        }
        catch {
            this.savePromise = null
            return false;
        }

    }

    async waitForSaveFinished():Promise<void> {
        return new Promise<void> (done => {
            const iv = setInterval( ()=>{
                if (this.savePromise) {
                    clearInterval(iv)
                    done()
                }
            }, 50)
        })
    }

    verify(settings:any) {
        if ( typeof settings === 'string') {    // string
            try {
                JSON.parse(settings)
                return true
            }
            catch {
                return false
            }
        }
        else {  // JSON Object
            try {
                JSON.stringify(settings)
                return true
            }
            catch {
                return false
            }
        }
    }

}