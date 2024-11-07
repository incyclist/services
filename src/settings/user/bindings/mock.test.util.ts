import { UserSettingsBinding } from "./types"

export class MockSettingsBinding  implements UserSettingsBinding {

    constructor(private readonly settings) {}
    
    async getAll ():Promise<any> { 
        return this.settings
    }
    async set  (key:string,value:any):Promise<boolean> {
        return true
    }
    async save (settings:any,final?:boolean):Promise<boolean> {
        return true
    }
    canOverwrite ():boolean {
        return true 
    }
    
}

