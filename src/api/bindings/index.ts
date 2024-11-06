import {Singleton} from '../../base/types'
import { IAppInfo } from '../appInfo'
import { IDownloadManager } from '../download'
import { IFormPostBinding } from '../form'
import { IFileSystem } from '../fs'
import { IPathBinding } from '../path'
import { IFileLoader, IJsonRepositoryBinding } from '../repository'
import { IVideoProcessor } from '../video'
import { ISecretBinding } from './secret'

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


}

export const getBindings  = ()=> {
    /*
    try {
        throw new Error()
    } 
    catch(err)
    {
        console.log('~~~ BINDING_GET ',err.stack)    
    }
    */
    return new IncyclistBindings() 
}

