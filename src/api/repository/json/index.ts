import {EventLogger} from "gd-eventlog"
import { JSONObject, JsonAccess } from "../types"
import { getBindings } from "../../bindings"

export class JsonRepository {

    protected static _instances: { [x: string]: JsonRepository } = {}

    static create(repoName:string):JsonRepository {
        if (JsonRepository._instances[repoName])
            return JsonRepository._instances[repoName]
            JsonRepository._instances[repoName] = new JsonRepository(repoName)
        return JsonRepository._instances[repoName]
    }

    protected name: string;
    protected db: string
    protected logger: EventLogger
    protected access: JsonAccess

    constructor(repoName:string) {
        this.name  = repoName;
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

    async delete(objectName:string):Promise<boolean> {
        return await this.access.delete(objectName)
    }


    protected async open():Promise<boolean> {

        if (this.access)
            return true

        
        const db = getBindings().db
        try {
            const existing = await db.get(this.name)
            if (existing) {
                this.access = existing
                return true;
            }
    
            const access =  await db.create(this.name)
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
        const db = getBindings().db
 
        db.release(this.name)
        this.access = null;
        return true
    }

   





}