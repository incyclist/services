/* eslint-disable @typescript-eslint/no-explicit-any */

import { IUserSettingsBinding } from "../../api";

export abstract class UserSettingsBinding implements IUserSettingsBinding {
    static getInstance():IUserSettingsBinding {
        throw new Error("Method not implemented.")
    }
    abstract getAll(): Promise<any>
    abstract set(key: string, value: any): Promise<boolean> 
    abstract save(settings: any, final?:boolean): Promise<boolean> 
    abstract canOverwrite(): boolean;
}
