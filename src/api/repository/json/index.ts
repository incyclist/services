import {EventLogger} from "gd-eventlog"
import { IJsonRepositoryBinding, JSONObject, JsonAccess } from "../types"

export class JsonRepository {

    protected static _instances: { [x: string]: JsonRepository } = {}
    protected static _defaultBinding: IJsonRepositoryBinding

    static create(repoName:string):JsonRepository {
        if (JsonRepository._instances[repoName])
            return JsonRepository._instances[repoName]
            JsonRepository._instances[repoName] = new JsonRepository(repoName)
        return JsonRepository._instances[repoName]
    }

    static setBinding(binding:IJsonRepositoryBinding) {
        JsonRepository._defaultBinding = binding
    }

    protected binding: IJsonRepositoryBinding
    protected name: string;
    protected db: string
    protected logger: EventLogger
    protected access: JsonAccess

    constructor(repoName:string, binding?:IJsonRepositoryBinding) {
        this.name  = repoName;
        this.binding = binding || JsonRepository._defaultBinding
        this.logger = new EventLogger(`Repo-${this.name}`)
    }


    getName():string {
        return this.name
    }

    async write(objectName:string, data:JSONObject):Promise<boolean> {
        await this.open()

        // TODO check if busy
        
        const success = await this.access.write(objectName,data)
        if (!success) {
            // TODO cache data in memory and retry later
        }
        return success
        

    }
    async read(objectName:string):Promise<JSONObject> {
        await this.open()

        // TODO check if busy
        
        try {
            const data = await this.access.read(objectName)
            
            if (!data) {
                // TODO 
            }
            return data
        }
        catch(err) {
            //console.log('~~~ DEBUG: ERROR',err)
            // TODO
        }
 
    }

    protected async open():Promise<boolean> {

        if (this.access)
            return true

        if (!this.binding) throw new Error('no binding specified')

        try {
            const existing = await this.binding.get(this.name)
            if (existing) {
                this.access = existing
                return true;
            }
    
            const access =  await this.binding.create(this.name)
            if (!access)
                return false;

            this.access = access
            return true;

        }
        catch(err) {
            return false
        }

    }

    protected async close():Promise<boolean> {        
        if (!this.binding) throw new Error('no binding specified')

        this.binding.release(this.name)
        this.access = null;
        return true
    }
   





}