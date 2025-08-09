import { EventLogger } from "gd-eventlog";
import { WorkoutParser } from "../types";
import { FileInfo, getBindings } from "../../../../api";
import { Limit, PowerLimit, SegmentDefinition, Step, StepDefinition, Workout } from "../../model";
import { IntervalsStep, IntervalsValue, IntervalsWorkout } from "./types";

export class IntervalsJsonParser implements WorkoutParser<string|IntervalsWorkout>{ 

    protected logger: EventLogger

    constructor () {
        this.logger = new EventLogger('IntervalsJsonParser')
    }

    async import(file: FileInfo, data): Promise<Workout> {

        this.logger.logEvent({message: 'parse', file:file?.url||file?.filename})

        try {
            const str = await this.getData(file,data)
            const workout = this.fromStr(str, file.name)
            return workout
        }
        catch(err) {
            this.logger.logEvent({message: 'parse failed', file:file?.url||file?.filename, reason:err.message})
            throw err
        }
    }

    fromStr(str: string, fileName?:string): Workout {

        try {

            const parsedData = JSON.parse(str) as IntervalsWorkout;
            return this.fromJSON(parsedData, fileName)

        }
        catch (err) {
            this.logger.logEvent({message: 'parse failed', file:fileName, reason:err.message})
            throw err
        }


    }

    fromJSON(data:IntervalsWorkout, fileName?:string): Workout {


        const name = fileName?.replace(/\.json$/i,'') 
        
        

        const workout =  new Workout({type:'workout',name,description: data.description});
        data.steps.forEach(s => {
            if ( !!s.reps) {
                const segment = this.convertSegment(s,data)
                workout.addSegment(segment)
            }

            else  {
                const step = this.convertStep(s,data)
                workout.addStep(step)
            }                
        });
        this.logger.logEvent({message: 'parse success', file:fileName})
        return workout
        
    }

    convertStep( step:IntervalsStep,workout:IntervalsWorkout) : StepDefinition {

        const duration = step.duration

        // Incyclist currently does not support distance based steps or steps with "untul lap pressed", reject workouts containing them
        if (duration===undefined || duration===null) {
            throw new Error (`Invalid Step description, no duration , ${JSON.stringify(step)}`)
        }
        const text = step.text
        const work = step.intensity==='active' || step.intensity==='interval' 
        const steady = !step.ramp
        let cooldown = step.cooldown 

        let power,cadence,hrm;
        if (!step.freeride) {
            const {ftp, lthr, sportSettings} = workout

            if (step.power)
                power = this.convertPower(step.power, {ftp,sportSettings, absolute:step._power})
            if (step.cadence)
                cadence = this.convertCadence(step.cadence)
            if (step.hr)
                hrm = this.convertHr(step.hr, {lthr,sportSettings, absolute:step._hr})
            
        }
        return {duration,power,cadence,hrm,text,work,steady,cooldown}

        

    }

    convertSegment( step:IntervalsStep,workout:IntervalsWorkout) : SegmentDefinition { 
        const repeat = step.reps
        const steps = step.steps.map(s => this.convertStep(s,workout))
        const text = step.text

        return {steps,repeat,text}

    }

    convertPower ( value:IntervalsValue, props?:{ftp?:number, sportSettings?:any, absolute?:IntervalsValue}) : PowerLimit {
        const power:PowerLimit = {}

        if (value.units === 'w') {
            power.type = 'watt'

            if (value.value) {
                power.min = power.max = value.value
            }
            else {
                power.min = Math.min(value.start,value.end) 
                power.max = Math.max(value.start,value.end) 
            }
        }
       
        else if (value.units === '%ftp') {
            power.type = 'pct of FTP'
            if (value.value) {
                power.min = power.max = value.value
            }
            else {
                power.min = Math.min(value.start,value.end) 
                power.max = Math.max(value.start,value.end) 
            }
        }
        else if (value.units === 'power_zone') {
            
            if (props?.ftp) {
                power.type = 'pct of FTP'
                if (props?.absolute) {
                    const abs = props?.absolute
                    const ftp = props?.ftp
                    power.min = Math.min(abs.start/ftp*100,abs.end/ftp*100) 
                    power.max = Math.max(abs.start/ftp*100,abs.end/ftp*100) 
                }
                else if (props?.sportSettings.power_zones) {
                    const zones = props?.sportSettings.power_zones
                    const ftp = props?.ftp

                    const minZoneValue = value?.value ?? Math.min(value?.start, value?.end)
                    const maxZoneValue = value?.value ?? Math.max(value?.start, value?.end)

                    const minZone = zones.findIndex(z => z.zone=== Math.round(minZoneValue))
                    const maxZone = zones.findIndex(z => z.zone=== Math.round(maxZoneValue))
                    

                    power.min = zones[minZone].minWatts/ftp*100
                    power.max = zones[maxZone].maxWatts/ftp*100

                }
                else {
                    throw new Error('cannot parse power zone: '+JSON.stringify(value))
                }

            }
            else {
                power.type = 'watt'
                if (props?.absolute) {
                    const abs = props?.absolute
                    power.min = Math.min(abs.start,abs.end) 
                    power.max = Math.max(abs.start,abs.end) 
                }
                else if (props?.sportSettings.power_zones) {
                    const zones = props?.sportSettings.power_zones

                    const minZoneValue = value?.value ?? Math.min(value?.start, value?.end)
                    const maxZoneValue = value?.value ?? Math.max(value?.start, value?.end)

                    const minZone = zones.findIndex(z => z.zone=== Math.round(minZoneValue))
                    const maxZone = zones.findIndex(z => z.zone=== Math.round(maxZoneValue))
                    

                    power.min = zones[minZone].minWatts
                    power.max = zones[maxZone].maxWatts

                }
                else {
                    throw new Error('cannot parse power zone: '+JSON.stringify(value))
                }


            }
            

        }
        else if (value.units === '%mmp') {

            power.type = 'watt' 
            if (!props?.absolute) {
                throw new Error('cannot parse power %mmp: '+JSON.stringify(value))                
            }
            const abs = props?.absolute

            if (value.value) {
                power.min = power.max = abs.start
            }
            else {
                power.min = Math.min(abs.start,abs.end) 
                power.max = Math.max(abs.start,abs.end) 
            }

        }
        return power
            
        
    }

    convertCadence ( value:IntervalsValue ) : Limit { 
        return {}

    }

    convertHr ( value:IntervalsValue, props?:{lthr?:number, sportSettings?:any, absolute?:IntervalsValue}) : Limit { 
        return {}
    }

    supportsExtension(extension:string): boolean {
        return extension === 'json'
    }

    supportsContent(str:string): boolean {
        try {
            const json = JSON.parse(str)


            const supported =  json.type!=='workout'
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