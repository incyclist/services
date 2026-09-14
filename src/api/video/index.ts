import { EventEmitter } from "node:events"
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
export type VideoHeadTail = {
    head?: Buffer
    tail?: Buffer
}

export interface IVideoProcessor {
    isScreenshotSuported():boolean
    isConvertSuported():boolean
    screenshot( url:string, props?): Promise<string>
    convert( url:string, props?): Promise<Observer>
    convertOnline(url:string, props?): Promise<IVideoConversion>

    // Reads a bounded head chunk and (if the file is larger than chunkSize) tail chunk of a
    // local video file, for a moov-atom-location probe (see RouteCard.remuxIfNotFaststart()).
    // Like convert()/screenshot(), not every platform binding implements this - desktop-only
    // today - and it throws 'not supported' where it isn't; callers should try/catch rather
    // than assume it exists.
    readHeadTail( url:string, chunkSize?:number ): Promise<VideoHeadTail>
}