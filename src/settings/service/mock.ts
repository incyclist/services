/* eslint-disable @typescript-eslint/no-explicit-any */
import { IUserSettingsBinding } from "../../api";
import { UserSettingsService } from "./service";


export class MockBinding implements IUserSettingsBinding {
    settings

    constructor(settings) {
        this.settings = settings
    }

    async getAll(): Promise<any> {
        return this.settings
    }
    async set(key: string, value: any): Promise<boolean> {
        this.settings[key]=value
        return true
    }
    async save(settings: any): Promise<boolean> {
        this.settings = settings
        return true;
    }
    canOverwrite(): boolean {
        return true
    }

}


export default class UserSettingsMock extends UserSettingsService {
    

 
    constructor(settings) {
        super()
        
        const binding = new MockBinding(settings)
        this.setBinding(binding)
        this.isInitialized = true

        UserSettingsService._instance = this
        this.settings = settings
    }

    



    
    
}