/* eslint-disable @typescript-eslint/no-explicit-any */
export interface IUserSettingsBinding {
    
    getAll(): Promise<any>
    set(key:string,value:any):Promise<boolean>
    save(settings:any):Promise<boolean>
    canOverwrite(): boolean;
}

export abstract class UserSettingsBinding implements IUserSettingsBinding {
    static getInstance():IUserSettingsBinding {
        throw new Error("Method not implemented.")
    }
    abstract getAll(): Promise<any>
    abstract set(key: string, value: any): Promise<boolean> 
    abstract save(settings: any): Promise<boolean> 
    abstract canOverwrite(): boolean;
}
