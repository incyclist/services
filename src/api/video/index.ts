import { Observer } from "../../base/types/observer"

export type ScreenshotProps = {
    outDir: string,
    position: number | string,
    size:string
}

export type ConvertProps = {
    outDir: string,
}

export interface IVideoProcessor {
    isScreenshotSuported():boolean
    isConvertSuported():boolean
    screenshot( url:string, props?): Promise<string>
    convert( url:string, props?): Promise<Observer>
    
}