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


/** 
 * @public 
 * @noInheritDoc

 * This represents a single step within a workout
 * */

export class Step implements StepDefinition {
    /** @public identifies the type of the Object (any of 'step', 'segment', 'workout', 'plan'*/
    public type: DataType

    /** @public starting time (in sec since start of workout) of the current step/segment/workout*/
    public start?:number

    /** @public end time (in sec since start of workout) of the current step/segment/workout*/
    public end?:number

    /** @public duration of the current step/segment/workout*/
    public duration: number

    /** @public the limits (max,min) set for power */    
    public power?: PowerLimit
    /** @public the limits (max,min) set for cadence*/    
    public cadence?: Limit
    /** @public the limits (max,min) set for power*/    
    public hrm?: Limit

    /** @public An optional text to be displayed for this step/segment*/    
    public text?: string

    /** @public identifies if the current step represents a work(true) or rest period (false) */    
    public work: boolean

    /** @public boolean to identify if the current step represents a work or rest period */    
    public steady: boolean
    public cooldown: boolean

    constructor( opts?, ignoreValidate?:boolean) {

        const {type,start,end,duration, power,cadence,hrm, text, work, steady, cooldown} = opts??{}
        const numVal = (s) => typeof(s)==='string' ? Number(s) : s

        this.type = type ??'step';
        this.start = (valid(start)) ? numVal(start) : undefined;
        this.end = (valid(end)) ? numVal(end) : undefined;
        this.duration = (valid(duration)) ? numVal(duration) :0;
        this.cadence = valid(cadence) ? clone(cadence) : undefined
        this.power = valid(power) ? clone(power) : undefined
        this.hrm = valid(hrm) ? clone(hrm) : undefined
        this.text = text ?? '';
        this.work = valid(work) ? work : false;
        this.steady = valid(steady) ? steady : true;
        this.cooldown = valid(cooldown) ? cooldown: false;

        if ( ignoreValidate===undefined || ignoreValidate===false)
            this.validate();
    }

    /** validates the values set for this seto/segment/workout
     * 
     * This will check that
     * - Start/End time and duration are correctly set
     * - Limits (if set) do contain at least a min or a max value and don't contradict  (e.g. min>max)
     * 
     * @throws Error Error object containing the cause of the validation failure
    */
    validate():void {
        this.validateTiming();
        this.validatePower();
        this.validateCadence();
        this.validateHrm();
    }

    /** @return number  duration (in sec) of the current step/segment/workout*/
    getDuration():number { return this.duration}

    /** @return number  starting time (in sec since start of workout) of the current step/segment/workout*/
    getStart():number { return this.start}
    /** @return number  end time (in sec since start of workout) of the current step/segment/workout*/
    getEnd():number { return this.end}


    /** returns the limits for a given timestamp within the training
     * 
     *
     * 
     * @throws Error Error object containing the cause of the validation failure
    */
    getLimits( ts:number,includeStepInfo:boolean=false):CurrentStep {
        
        const rv = (limits) => {
            const l = this.getRemainder(limits, includeStepInfo)
            l.start = this.start
            return l
        }

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

    /**  @ignore */
    public validateTiming():boolean {
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

    protected validateLimit( p:Limit, name:string):boolean {
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

    protected validatePower():boolean {
        if ( valid(this.power)) {
            const p = this.power;
            p.type = p.type??'watt'
            return this.validateLimit(p, 'power')
        }
        return true;
    }

    protected validateCadence() {
        return this.validateLimit(this.cadence, 'cadence')
    }
    protected validateHrm() {
        return this.validateLimit(this.hrm, 'hrm')
    }


    protected getRemainder ( limits:CurrentStep, includeStepInfo:boolean=false):CurrentStep  {
        if (limits===undefined) return;
        if ( includeStepInfo)
            limits.step = this;
        return limits;
    }


    protected calc  (ts,limit,includeStepInfo:boolean, isPower=false)  {
        if (!limit) {
            return ({});
        }

        const sl = (limits) => this.getRemainder( isPower ? { ...limits, type} : limits, includeStepInfo)

        const type = isPower ? limit.type : undefined
        const part = (ts-this.start) / this.duration;


        if ( limit.max===undefined && limit.min===undefined) {
            return sl({})
        }
        if ( limit.max===undefined && limit.min!==undefined) {
            return sl({min:limit.min})
        } 
        
        if ( this.cooldown) {
            const max = limit.min!==undefined ? limit.max-part*(limit.max-limit.min) : limit.max-part*(limit.max)
            const min = isPower ? max : limit.min
            return sl({min,max});
        }
        
        if ( limit.min===undefined && limit.max!==undefined) {
            return sl({max:limit.max})
        } 
        const max = limit.max!==undefined ? part*(limit.max-limit.min)+limit.min : limit.max
        const min = isPower ? max : limit.min        
        return sl({min,max});
        
        
    }

}


