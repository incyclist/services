/* eslint-disable @typescript-eslint/no-explicit-any */
import {EventLogger} from 'gd-eventlog'
import clone from '../../utils/clone';
import { merge } from '../../utils/merge';
import { valid } from '../../utils/valid';
import {IUserSettingsBinding } from './bindings';



export class UserSettingsService {

    static _instance:UserSettingsService;

    settings: any
    binding: IUserSettingsBinding
    logger: EventLogger
    isInitialized: boolean
    isDirty: boolean
    savePromise: Promise<boolean> | null
    

    static getInstance() {
        if ( !UserSettingsService._instance ) {
            UserSettingsService._instance = new UserSettingsService();
        }
        return UserSettingsService._instance;
    }

    constructor (binding?: IUserSettingsBinding) {
        this.settings = {};
        this.logger = new EventLogger('UserSettings')
        this.isInitialized = false;
        this.isDirty = false
        this.savePromise = null;

        this.setBinding(binding)
    }

    setBinding(binding: IUserSettingsBinding) {
        this.binding = binding;        
    }


    async init():Promise<boolean> {

        if (this.isInitialized)
            return true;
        if (!this.binding)
            return false;

        try {            
            this.settings = await this.binding.getAll()
            this.logger.logEvent({message:'settings loaded'})
            this.isInitialized = true;
            return true;
        }
        catch(err) {
            this.logger.logEvent({message:'settings could not be loaded', error:err.message})
            return false;
        }
    }

    getAll() {
        if (!this.isInitialized)
            throw new Error('Settings are not yet initialized')

        const settings = clone(this.settings)
        return settings
    }

    get( key:string, defValue:any ):any {

        if (!this.isInitialized)
            throw new Error('Settings are not yet initialized')

        const settings = this.settings
        const keys = key.split('.');
        if (keys.length<2)
            return settings[key] || defValue
        
        const retVal = (value) => valid(value) ? clone(value) : value;
    
        let child = {}
        for (let index=0;index<keys.length;index++) {
            const k = keys[index];
    
            if (index===keys.length-1)
                return  retVal(child[k] || defValue);
            else { 
                child = index===0? settings[k] : child[k]
                if ( child===undefined) {
                    return retVal(defValue)
                    
                }   
            }
        
        }
    }


    set( key:string, value:any, save:boolean=true):void {
        if (!this.isInitialized)
            throw new Error('Settings are not yet initialized')

        const settings = this.settings;

        if ( key===undefined || key===null || key==='') {
            throw new Error('key must be specified')
        }

        const keys = key.split('.');
        if (keys.length<2) {
            if (value===null)
                delete settings[key]
            else 
                settings[key] = value 
            
            if(save)
                this.save()      
            return value;
        }
    
        let child = {}
        for (let index=0;index<keys.length;index++) {
            const k = keys[index];
    
            if (index===keys.length-1) {
                if (value===null)
                    delete child[k]
                else 
                    child[k] = value;
                if (save)
                    this.save()
                return value;
            }
            else { 
                const prev = index===0? settings : child
                child = index===0? settings[k] : child[k]
                if ( child===undefined) {
                    prev[k] = child = {}
                    
                }   
            }
        
        }
    }

    async update(data:any):Promise<boolean> {
        return await this.updateSettings(data)
    }

    async updateSettings(data:any):Promise<boolean> {        
        if (!this.isInitialized)
        throw new Error('Settings are not yet initialized')
        try {

            merge(this.settings,data);
            await this.save()

            return true;
        }
        catch ( err) {
            this.logger.logEvent({message:'error',fn:'updateSettings()',data,error:err.message})
            return false;
        }    
    }    

    async save():Promise<void> {
        if (!this.isInitialized) 
            throw new Error('Settings are not yet initialized')

        if (this.savePromise) {
            this.isDirty = true;
            return;
        }
        
        //console.log('~~~ save settings', this.settings.capabilities[0].selected)
        this.savePromise =  this.binding.save(this.settings)
        this.isDirty = false;

        try {
            await this.savePromise;
            this.savePromise =null;

            if (this.isDirty) {
                this.isDirty = false;
                await this.save()
            }
        }
        catch(err) {
            this.logger.logEvent({message:'Error', fn:'save()', error:err.message, stack:err.stack})
            this.isDirty = false; // retry will not help
        }
        return
    }

    
    async onAppClose(): Promise<void> {
        this.binding.save(this.settings, true)
    }


}

export const useUserSettings = ()=>UserSettingsService.getInstance()

export const initUserSettings = (binding: IUserSettingsBinding)=> {
    const us = UserSettingsService.getInstance()
    us.setBinding(binding)
    return us
}
