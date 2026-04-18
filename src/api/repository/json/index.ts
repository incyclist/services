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
    protected db?: string
    protected logger: EventLogger
    protected access?: JsonAccess

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
        if (!this.access)
            return false

        const success = await this.access.write(this.toFileName(objectName), data)

        
        // migrate legacy file if it exists
        if (objectName.includes(':')) {
            await this.access.delete(objectName).catch(() => { /* intentionally empty */ })
        }
        return success                
    }

    async read(objectName:string):Promise<JSONObject|undefined> {
        await this.open()
        if (!this.access)
            return;

        const fileName = this.toFileName(objectName)

        let data 

        try {
            data = await this.access.read(fileName)
        }
        catch {/* intentionally empty */}

        // fall back to legacy filename if not found

        try {
            if (!data  && objectName.includes(':')) {
                data = await this.access.read(objectName)
            }

            const str = JSON.stringify(data)
            if (str === '{}' || str.length < 2)
                return
        }
        catch {
            return
        }
        return data

    }

    async delete(objectName:string):Promise<boolean> {
        await this.open()
        if (!this.access)
            return false;
            
        const result = await this.access.delete(this.toFileName(objectName))

        if (objectName.includes(':'))
            await this.access.delete(objectName).catch(() => { /* intentionally empty */ })

        return result        
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
        catch {
            return false
        }

    }

    async list( exclude?:string|Array<string>):Promise<Array<string>|null> {
        await this.open()
        if (!this.access)
            return null;
            

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
        delete this.access
        return true
    }


    protected toFileName(objectName: string): string {
        return objectName.replaceAll(':', '_')
    }



}