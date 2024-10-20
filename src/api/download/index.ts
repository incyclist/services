import EventEmitter from "events"

export type DownloadProps = {
    i?:string
}
export interface IDownloadSession extends EventEmitter {
    start()
    stop()
}


export interface IDownloadManager {
    createSession(url:string,fileName:string,props?:DownloadProps):IDownloadSession 
}