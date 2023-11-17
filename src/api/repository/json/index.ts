import {EventLogger} from "gd-eventlog"
import { IRepositoryBinding, JSONObject } from "../types"

export class JsonRepository {

    protected static _instances: { [x: string]: JsonRepository } = {}
    protected static _defaultBinding: IRepositoryBinding

    static create(repoName:string):JsonRepository {
        if (JsonRepository._instances[repoName])
            return JsonRepository._instances[repoName]
            JsonRepository._instances[repoName] = new JsonRepository(repoName)
        return JsonRepository._instances[repoName]
    }

    static setBinding(binding:IRepositoryBinding) {
        JsonRepository._defaultBinding = binding
    }

    protected binding: IRepositoryBinding
    protected name: string;
    protected db: string
    protected logger: EventLogger

    constructor(repoName:string, binding?:IRepositoryBinding) {
        this.name  = repoName;
        this.binding = binding || JsonRepository._defaultBinding
        this.logger = new EventLogger(`Repo-${this.name}`)
    }

    protected async open():Promise<boolean> {
        if (!this.binding) throw new Error('no binding specified')

        try {
            const existing = await this.binding.get(this.name)
            if (existing) {
                return true;
            }
    
            return  await this.binding.create(this.name)
        }
        catch(err) {
            return false
        }

    }

    protected async close():Promise<boolean> {        
        if (!this.binding) throw new Error('no binding specified')

        this.binding.release(this.name)
        return true
    }

    protected write(objectName:string, data:JSONObject):Promise<boolean> {
        if (!this.binding) throw new Error('no binding specified')

        // TODO check if busy
        
        const success = this.binding.write(objectName,data)
        if (!success) {
            // TODO cache data in memory and retry later
        }
        return success
        

    }
    protected read(objectName:string):Promise<JSONObject> {
        if (!this.binding) throw new Error('no binding specified')

        // TODO check if busy
        
        try {
            const data = this.binding.read(objectName)
            
            if (!data) {
                // TODO 
            }
            return data
        }
        catch(err) {
            // TODO
        }
 
    }

    





}