import {Singleton} from '../../base/types'
import { IAppInfo } from '../appInfo'
import { IDownloadManager } from '../download'
import { IFileSystem } from '../fs'
import { IPathBinding } from '../path'
import { IFileLoader, IJsonRepositoryBinding } from '../repository'
import { IVideoProcessor } from '../video'

@Singleton
export class IncyclistBindings {
    public path?:IPathBinding
    public db:IJsonRepositoryBinding
    public loader?:IFileLoader
    public video?: IVideoProcessor
    public appInfo?: IAppInfo
    public fs?: IFileSystem
    public downloadManager?: IDownloadManager

}

export const getBindings  = ()=> new IncyclistBindings()
