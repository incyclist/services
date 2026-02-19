import { EventEmitter } from "events"
import { Observer } from "../../base/types/observer"

export type ScreenshotProps = {
    outDir: string,
    position: number | string,
    size:string
}

export type VideoConvertProps = {
    outDir: string,
}

export interface IVideoConversion extends EventEmitter{
    next():Promise<Buffer>
    stop():Promise<void>

}
export interface IVideoProcessor {
    isScreenshotSuported():boolean
    isConvertSuported():boolean
    screenshot( url:string, props?): Promise<string>
    convert( url:string, props?): Promise<Observer>        
    convertOnline(url:string, props?): Promise<IVideoConversion>
}