import {EventLogger} from "gd-eventlog"
import { JsonAccess } from "../types"
import { JSONObject } from "../../../utils/xml"
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

    getPath():string {
        const db = getBindings().db
        return db.getPath(this.name)
    }

    getName():string {
        return this.name
    }

    async write(objectName:string, data:JSONObject):Promise<boolean> {
        await this.open()

        const success = await this.access.write(objectName,data)
        return success
        

    }
    async read(objectName:string):Promise<JSONObject> {
        await this.open()

        const data = await this.access.read(objectName)
        return data

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

    async list( exclude?:string|Array<string>):Promise<Array<string>> {

        try {
            
            let names = await this.access.list()
            if (!names)
                return null

            names = names.filter(name=>name.toLowerCase().endsWith('.json'))
            names = names.map( name=> name.substring(0,name.length-5))

            if (exclude) {
                const excludes = (typeof(exclude)==='string') ? [exclude] : exclude
                names= names.filter( name => !excludes.includes(name))
            }
            return names

        }
        catch {
            return null;
        }

    }


    protected async close():Promise<boolean> {        
        const db = getBindings().db
 
        db.release(this.name)
        this.access = null;
        return true
    }






}