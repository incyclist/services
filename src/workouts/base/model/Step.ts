import clone from "../../../utils/clone"
import { valid } from "../../../utils/valid"
import { CurrentStep, DataType, Limit, PowerLimit, StepDefinition } from "./types"

export const STEP_TYPE = {
    STEP : 'step',
    SEGMENT: 'segment'
}

export const POWER_TYPE = {
    WATT : 'watt',
    PCT: 'pct of FTP'
}



export default class Step implements StepDefinition {
    public type: DataType
    public start?:number
    public end?:number
    public duration: number
    public power?: PowerLimit
    public cadence?: Limit
    public hrm?: Limit
    public text: string
    public work: boolean
    public steady: boolean
    public cooldown: boolean

    constructor( opts?, ignoreValidate?:boolean) {

        const {type,start,end,duration, power,cadence,hrm, text, work, steady, cooldown} = opts||{}
        const numVal = (s) => typeof(s)==='string' ? Number(s) : s

        this.type = type ||'step';
        this.start = (valid(start)) ? numVal(start) : undefined;
        this.end = (valid(end)) ? numVal(end) : undefined;
        this.duration = (valid(duration)) ? numVal(duration) :0;
        this.cadence = valid(cadence) ? clone(cadence) : undefined
        this.power = valid(power) ? clone(power) : undefined
        this.hrm = valid(hrm) ? clone(hrm) : undefined
        this.text = text || '';
        this.work = valid(work) ? work : false;
        this.steady = valid(steady) ? steady : true;
        this.cooldown = valid(cooldown) ? cooldown: false;

        if ( ignoreValidate===undefined || ignoreValidate===false)
            this.validate();
    }

    validate() {
        this.validateTiming();
        this.validatePower();
        this.validateCadence();
        this.validateHrm();
    }

    getDuration():number { return this.duration}
    getStart():number { return this.start}
    getEnd():number { return this.end}

    validateTiming():boolean {
        if ( this.start===undefined && this.end===undefined ) {
            throw new Error(`Invalid Step description, start or end needs to be provided `)
        }
        else if ( this.start!==undefined && this.end===undefined) {
            this.end = this.start+ this.duration
            return true;
        }
        else if ( this.start===undefined && this.end!==undefined) {
            this.start = this.end - this.duration
            return true;
        }

        else if ( this.start!==undefined && this.end!==undefined && this.duration===0) {
            this.duration = this.end - this.start
            if ( this.duration<0) throw new Error(`Invalid Step description, duration:${this.duration} `)
            return true;
        }
        else {
            const delta  = Math.abs(this.duration - ( this.end-this.start))
            if ( delta>0) throw new Error(`Invalid step description, duration does not match start and end `)
            return true;
        }
    }

    validateLimit( p:Limit, name:string):boolean {
        if ( valid(p)) {
            if (p.min===undefined && p.max===undefined)
                throw new Error(`Invalid Step description, ${name}: no values specified`)

            if (p.min!==undefined && p.max!==undefined && p.min>p.max )
                throw new Error(`Invalid Step description, min ${name} > max ${name}`)
            if (p.min!==undefined && p.min<0)
                throw new Error(`Invalid Step description, min ${name} <0`)
            if (p.max!==undefined && p.max<0)
                throw new Error(`Invalid Step description, max ${name} <0`)

        }
        return true;
    }

    validatePower():boolean {
        if ( valid(this.power)) {
            const p = this.power;
            if (p.type===undefined) 
                p.type= 'watt';

            return this.validateLimit(p, 'power')
        }
        return true;
    }

    validateCadence() {
        return this.validateLimit(this.cadence, 'cadence')
    }
    validateHrm() {
        return this.validateLimit(this.hrm, 'hrm')
    }

    getLimits( ts:number,includeStepInfo:boolean=false) {
        
        const rv = (limits) => this.getRemainder(limits, includeStepInfo)

        if  (ts>=this.start && ts<=this.end) {
            const duration = this.duration;
            const remaining = this.end-ts;

            if ( this.steady ) {
                 const { power, cadence, hrm, text, work} = this;
                 return rv ({ power, cadence, hrm, text, work,duration,remaining});
            }
            else {
                const { text, work} = this;
                
                const power = this.calc(ts,this.power,includeStepInfo,true);
                const cadence = this.calc(ts,this.cadence,includeStepInfo);
                const hrm = this.calc(ts,this.hrm,includeStepInfo);
                
                return rv({ power, cadence, hrm, text, work,duration, remaining});
            }

        }
        else {
            return undefined
        }
        

    }

    getRemainder ( limits:CurrentStep, includeStepInfo:boolean=false):CurrentStep  {
        if (limits===undefined) return;
        if ( includeStepInfo)
            limits.step = this;
        return limits;
    }


    calc  (ts,limit,includeStepInfo:boolean, isPower=false)  {
        if (!limit)
            return ({});
        const type = isPower ? limit.type : undefined

        const rv = (limits) => this.getRemainder( isPower ? { ...limits, type} : limits, includeStepInfo)

        const part = (ts-this.start) / this.duration;


        if ( limit!==undefined ) {
            if ( limit.max===undefined && limit.min===undefined) {
                return rv({})
            }

            let min,max;
            if ( this.cooldown) {
                if ( limit.max===undefined && limit.min!==undefined) {
                    return rv({min:limit.min})
                } 
                max = limit.min!==undefined ? limit.max-part*(limit.max-limit.min) : limit.max-part*(limit.max)
                min = isPower ? max : limit.min
            }
            else {
                if ( limit.max===undefined && limit.min!==undefined) {
                    return rv({min:limit.min})
                } 
                if ( limit.min===undefined && limit.max!==undefined) {
                    return rv({max:limit.max})
                } 
                max = min = limit.max!==undefined ? part*(limit.max-limit.min)+limit.min : limit.max
                min = isPower ? max : limit.min
            }
            limit = {min,max}
        }
        return rv(limit);
    }

}


