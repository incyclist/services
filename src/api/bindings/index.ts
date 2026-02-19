import {Singleton} from '../../base/types'

import type { IAppInfo } from '../appInfo'
import type { IDownloadManager } from '../download'
import type { IFormPostBinding } from '../form'
import type { IFileSystem } from '../fs'
import type { ILogBinding } from '../logging/types'
import type { IMessageQueueBinding } from '../mq'
import type { IPathBinding } from '../path'
import type { IFileLoader, IJsonRepositoryBinding } from '../repository/types'
import type { INativeUI } from '../ui'
import type { IVideoProcessor } from '../video'
import type { ISecretBinding } from '../secret'
import type { ISerialBinding } from '../serial/types'
import type { ICryptoBinding } from '../crypto/types'


export interface IUserSettingsBinding {
    
    getAll(): Promise<any>
    set(key:string,value:any):Promise<boolean>
    save(settings:any,final?:boolean):Promise<boolean>
    canOverwrite(): boolean;
}

@Singleton
export class IncyclistBindings {
    public path?:IPathBinding
    public db:IJsonRepositoryBinding
    public loader?:IFileLoader
    public video?: IVideoProcessor
    public appInfo?: IAppInfo
    public fs?: IFileSystem
    public downloadManager?: IDownloadManager
    public form?:IFormPostBinding;
    public secret?:ISecretBinding
    public mq: IMessageQueueBinding
    public ui: INativeUI
    public settings: IUserSettingsBinding
    public logging: ILogBinding
    public serial: ISerialBinding
    public crypto: ICryptoBinding
    public ant
    public ble
    public wifi
}

export const getBindings  = ()=> {
    return new IncyclistBindings() 
}

