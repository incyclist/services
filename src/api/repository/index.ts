import type {JsonAccess,IJsonRepositoryBinding} from './types'

export * from './json'
export abstract class AbstractJsonRepositoryBinding implements IJsonRepositoryBinding {
    abstract create(name:string):Promise<JsonAccess|null>
    abstract get(name:string):Promise<JsonAccess|null>
    abstract release(name:string):Promise<boolean>
    abstract getPath(name:string):string
}


