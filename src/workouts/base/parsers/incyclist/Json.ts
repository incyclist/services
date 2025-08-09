import { FileInfo, getBindings } from "../../../../api";
import { valid } from "../../../../utils/valid";
import { Workout } from "../../model/Workout";
import { WorkoutParser } from "../types";
import {EventLogger} from 'gd-eventlog'

export class JsonParser implements WorkoutParser<string>{

    protected logger: EventLogger

    constructor () {
        this.logger = new EventLogger('JsonParser')
    }

    async import(file: FileInfo, data): Promise<Workout> {
        this.logger.logEvent({message: 'parse', file:file?.url||file?.filename})

        try {
            const str = await this.getData(file,data)
            const parsedData = JSON.parse(str);
            const {name,description,category,steps,type='workout'} = parsedData;

            const workout =  new Workout({type,name,description,category});
            steps.forEach(step => {
                if ( step.type==='step') {
                    workout.addStep(step)
                }
                if ( step.type==='segment') {
                    workout.addSegment(step)
                }                
            });
            this.logger.logEvent({message: 'parse success', file:file?.url||file?.filename})

            return workout
        }
        catch(err) {
            this.logger.logEvent({message: 'parse failed', file:file?.url||file?.filename, reason:err.message})
            throw err
        }
    }

    supportsExtension(extension: string): boolean {
        return extension.toLowerCase()==='json'
    }

    supportsContent(str:string): boolean {
        try {
            const json = JSON.parse(str)
            const supported = json?.type==='workout' && valid(json?.name) && valid(json?.steps) && Array.isArray(json?.steps)

            return supported
        }
        catch {
            return false
        }
    }


    async getData(file:FileInfo, data?:string):Promise<string> {
        if (data)
            return data

        const loader = getBindings().loader
        const res = await loader.open(file)
        if (res.error) {
            throw new Error('Could not open file')
        }        
        return res.data

    }
}