import {EventEmitter} from "node:events"

export type DownloadProps = {
    i?:string
}
export interface IDownloadSession extends EventEmitter {
    start()
    stop()
}


export interface IDownloadManager {
    createSession(url:string,fileName:string,props?:DownloadProps):IDownloadSession 
    getVideoDir?():string
    /** optional: free bytes on the volume that holds `path` (the video dir if omitted); `undefined` if unknown */
    getFreeSpace?(path?:string):Promise<number|undefined>
}