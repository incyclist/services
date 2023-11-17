export type JSONObject =
    | string
    | number
    | boolean
    | { [x: string]: JSONObject }
    | Array<JSONObject>;


export interface IRepositoryBinding {

    
    create(name:string):Promise<boolean>
    get(name:string):Promise<boolean>
    release(name:string):Promise<boolean>

    read(resourceName:string):Promise<JSONObject>
    write(resourceName:string,data:JSONObject):Promise<boolean>

    
}

