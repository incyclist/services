import { JSONObject } from "../../utils/xml";

export type JsonAccess = {
    read(resourceName:string):Promise<JSONObject>
    write(resourceName:string,data:JSONObject):Promise<boolean>
    delete(resourceName:string):Promise<boolean>
    list():Promise<Array<string>>

}

export interface IJsonRepositoryBinding {
    create(name:string):Promise<JsonAccess|null>
    get(name:string):Promise<JsonAccess|null>
    release(name:string):Promise<boolean>
    getPath(name:string):string

}

export interface FileLoaderError {
    message: string
    key: string
}

export interface FileLoaderResult {
    error?:FileLoaderError,
    data?:string|Buffer,
}


export interface FileInfo {
    type:'url'|'file'
    url?:string,
    base?:string        // the name of the file with extension (index.html)
    name:string,        // just the name of the file (index)
    filename?:string,   // full path
    dir:string,         // directory
    ext:string,         // extension
    delimiter: string,
    encoding?
}

export interface IFileLoader {
    open(file:FileInfo):Promise<FileLoaderResult>
}
