export type JSONObject =
    | string
    | number
    | boolean
    | { [x: string]: JSONObject }
    | Array<JSONObject>;

export type JsonAccess = {
    read(resourceName:string):Promise<JSONObject>
    write(resourceName:string,data:JSONObject):Promise<boolean>
    delete(resourceName:string):Promise<boolean>
}

export interface IJsonRepositoryBinding {

    
    create(name:string):Promise<JsonAccess|null>
    get(name:string):Promise<JsonAccess|null>
    release(name:string):Promise<boolean>

}
export abstract class AbstractJsonRepositoryBinding implements IJsonRepositoryBinding {
    abstract create(name:string):Promise<JsonAccess|null>
    abstract get(name:string):Promise<JsonAccess|null>
    abstract release(name:string):Promise<boolean>
}

export interface FileLoaderError {
    message: string
    key: string
}

export interface FileLoaderResult {
    error?:FileLoaderError,
    data?,
    epmEpp?
}


export interface FileInfo {
    type:'url'|'file'
    url:string,
    name:string,
    dir:string,
    ext:string,
    delimiter: string
}

export interface IFileLoader {
    open(file:FileInfo):Promise<FileLoaderResult>
}




/*
*/
