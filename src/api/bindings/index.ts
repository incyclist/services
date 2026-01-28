import {Singleton} from '../../base/types'
import { IAppInfo } from '../appInfo'
import { IDownloadManager } from '../download'
import { IFormPostBinding } from '../form'
import { IFileSystem } from '../fs'
import { ILogBinding } from '../logging/types'
import { IMessageQueueBinding } from '../mq'
import { IPathBinding } from '../path'
import { IFileLoader, IJsonRepositoryBinding } from '../repository'
import { INativeUI } from '../ui'
import { IVideoProcessor } from '../video'
import { ISecretBinding } from '../secret'
import { ISerialBinding } from '../serial/types'


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
    public ant
    public ble
    public wifi
}

export const getBindings  = ()=> {
    return new IncyclistBindings() 
}

