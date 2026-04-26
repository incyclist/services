import { FileInfo } from "../../../api";
import { RouteBase, RouteInfo } from "../types";


export type Position = {
    distance?: string;
    lat?: string;
    lon?: string;
    fp?: string;
};
export type Altitude = {
    distance?: string;
    height?: string;
};

export type CutInfo = {
    time: number;
    startFrame?: number;
    endFrame?: number;
}

export interface ParseResult<T extends RouteBase> {
    data: RouteInfo
    details: T
}

export interface Parser<In, Out extends RouteBase> {
    import(file: FileInfo, data?:In): Promise< ParseResult<Out>>
    supportsExtension(extension:string):boolean
    supportsContent(data:In):boolean
    getData(info:FileInfo,data?:In):Promise<In>
    
    getPrimaryExtension(): string
    getCompanionExtensions(): string[]
}
