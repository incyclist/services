import {EventLogger} from 'gd-eventlog'
import { WorkoutParser } from '../types';
import { FileInfo, getBindings } from '../../../../api';
import { Workout } from '../../model/Workout';
import xml2js from 'xml2js';
import { Limit, PowerLimit, SegmentDefinition, StepDefinition } from '../../model/types';
import { parseXml } from '../../../../utils/xml';
import { ignoreEmpty } from '../../../../utils';

const parser = new xml2js.Parser({explicitChildren :true,preserveChildrenOrder :true,mergeAttrs :false} );


const intVal = v=>!!v ? Number.parseInt(v) : undefined;
const floatVal = v=>!!v ? Number.parseFloat(v) : undefined;
const pVal   = v => !!v ? floatVal(v)*100 : undefined

const setPowerValues = (power,powerTarget) => {
    if (power.max === undefined && power.min === undefined) {
        power.max = powerTarget;
        power.min = powerTarget;
    }
    else if (power.max !== undefined && power.min === undefined) {
        power.min = powerTarget;
    }
    else if (power.min !== undefined && power.max === undefined) {
        power.max = powerTarget;
    }
}

interface ParseResult  {
    step?: StepDefinition,
    segment?: SegmentDefinition

}

type ParserContext = {   
    ftpOverride?: number,
}

/* 
  Implementation based on : https://github.com/h4l/zwift-workout-file-reference/blob/master/zwift_workout_file_tag_reference.md
  */

export class ZwoParser implements WorkoutParser<string>{

    protected logger: EventLogger
    protected tagHandlers: Record<string,(json)=>ParseResult>
    protected context: ParserContext

    constructor () {

        this.logger = new EventLogger('ZwoParser')
        this.tagHandlers =  {}
        this.initHandlers()
    }
    
    async import(file: FileInfo, data?: string): Promise<Workout> {       
        const str = await this.getData(file,data)
        
        return this.fromStr(str, file.name)
    }

    async fromStr(str: string, fileName?:string): Promise<Workout> {
        const xml = await parseXml(str)
        xml.expectScheme('workout_file')   

        const name = ignoreEmpty(xml.json['name']) ?? fileName       
        const description = ignoreEmpty(xml.json['description'])
        const workout = new Workout( {type:'workout',name,description});
        return this.parse(str,workout)
        
    }


    supportsExtension(extension: string): boolean {
        return extension.toLowerCase()==='zwo'
    }

    supportsContent(): boolean {
        return true
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


    

    protected getPowerLimit(json, reverse?:boolean):PowerLimit {
        const power:PowerLimit= {type:'pct of FTP'}

        let powerTarget;

        const {Power, PowerHigh, PowerLow }  = json;

        if (Power===undefined && PowerHigh===undefined && PowerLow===undefined)
            return undefined;

        power.max = pVal(PowerHigh)
        power.min = pVal(PowerLow)
        
        if (Power) {
            powerTarget = pVal(Power);
            setPowerValues(power,powerTarget);
        }        

        if ( !!this.context.ftpOverride) {
            power.max = power.max ? Math.round(this.context.ftpOverride * power.max/100) : undefined
            power.min = power.min ? Math.round(this.context.ftpOverride * power.min/100) : undefined
            power.type = 'watt'
        }

        return power;
    }

    protected getCadenceLimit( json,reverse?:boolean):Limit {
        const {Cadence, CadenceHigh, CadenceLow }  = json;
        let cadence;
        if (Cadence) {
            cadence = { min:intVal(Cadence),max:intVal(Cadence)}
        }
        if (CadenceLow) {
            if ( cadence===undefined) cadence= {};
            if ( reverse!==true)
                cadence.min = intVal(CadenceLow)
            else
                cadence.max = intVal(CadenceLow)
        }
        if (CadenceHigh) {
            if ( cadence===undefined) cadence= {};
            if ( reverse!==true)
                cadence.max = intVal(CadenceHigh)
            else
                cadence.min = intVal(CadenceHigh)
            }
        return cadence        
    }

    protected parseRamp(json):ParseResult {
        const {Duration, Text }  = json;

        let cadence = this.getCadenceLimit(json);
        let power = this.getPowerLimit(json)
        let cooldown = false;
        if ( power && power.min>power.max) {
            const p = {...power};
            power = {min:p.max,max:p.min,type:p.type}
            cooldown = true;
        }
        if ( cadence && cadence.min>cadence.max) {
            const c = {...cadence};
            cadence = {min:c.max,max:c.min}
            cooldown = true;
        }

        const duration = intVal(Duration);
        const text = Text;

        return  { step:{duration,power,cadence,text,steady:false,work:true,cooldown} }
    }

    protected parseWarmup(json):ParseResult {
        const {Duration, Text }  = json;

        const cadence = this.getCadenceLimit(json);
        let power = this.getPowerLimit(json)
        const duration = intVal(Duration);
        const text = Text;
        const steady = (power?.min===power?.max || !power?.min || !power?.max );
        if (power?.max<power?.min) {
            const p = {...power};
            power = {...p,min:p.max,max:p.min}
        }


        return  { step:{duration,power,cadence,text,steady,cooldown:false} }
    }

    protected parseCooldown(json):ParseResult {
        const {Duration, Text }  = json;

        const cadence = this.getCadenceLimit(json,true);
        let power = this.getPowerLimit(json,true)
        const duration = intVal(Duration);
        const text = Text;
        const steady = (power?.min===power?.max || !power?.min || !power?.max );
        if (power?.max<power?.min) {
            const p = {...power};
            power = {...p,min:p.max,max:p.min}
        }

        return  { step:{duration,power,cadence,text,steady,cooldown:true} }
    }

    protected parseSteadyState(json):ParseResult {
        const {Duration, Text }  = json;

        const power = this.getPowerLimit(json);
        const cadence = this.getCadenceLimit(json);
        const duration = intVal(Duration);
        const text = Text;

        return  { step:{duration,power,cadence,text,work:true} }
    }

    protected parseIntervalsT(json):ParseResult {
        const {CadenceResting,Repeat,OnDuration, OffDuration, OffPower,PowerOffHigh, PowerOffLow, OnPower, PowerOnHigh,PowerOnLow}  = json;

        const repeat = Repeat ? intVal(Repeat) :1;
        const on = {
            power: this.getPowerLimit( {Power:OnPower,PowerHigh:PowerOnHigh, PowerLow:PowerOnLow}),
            cadence: this.getCadenceLimit( json),
            duration: intVal(OnDuration),
            work: true
        }
        
        const off = {
            power: this.getPowerLimit( {Power:OffPower,PowerHigh:PowerOffHigh, PowerLow:PowerOffLow}),
            cadence: this.getCadenceLimit( {Cadence:CadenceResting}),
            duration: intVal(OffDuration),
            work: false
        }
        return  { segment: { steps: [on, off], repeat } }        
    }

    protected parseFreeRide(json):ParseResult {
        // Cadence Duration FlatRoad ftptest Power show_avg 
        const {Duration,ftptest}  = json;

        const duration = intVal(Duration);
        const work = ftptest===true || ftptest==='1';

        return  { step:{duration,work} }
    }

    protected parseFreeride(json):ParseResult {
        return this.parseFreeRide(json)
    }

    protected parseMaxEffort(json):ParseResult {
        // Duration FlatRoad  
        const {Duration}  = json;

        const duration = intVal(Duration);
        return  { step:{duration,work:true} }
    }

    protected initHandlers() {
        const th = this.tagHandlers;
        
        th['SteadyState']= this.parseSteadyState.bind(this);
        th['Ramp']= this.parseRamp.bind(this);
        th['Warmup']= this.parseWarmup.bind(this);
        th['Cooldown']= this.parseCooldown.bind(this);
        th['IntervalsT']=this.parseIntervalsT.bind(this);
        th['Freeride']=this.parseFreeride.bind(this);
        th['FreeRide']=this.parseFreeRide.bind(this); // yes there are two tags with almost the same spelling !?!
        th['MaxEffort']=this.parseMaxEffort.bind(this);
    }

    protected handleTag(tagName:string, tagValue:string) {
        const fnHandler = this.tagHandlers[tagName];
        if ( fnHandler) {
            return fnHandler(tagValue)
        }
        else {
            this.logger.logEvent( {message:'unknown tag', tag:tagName, data: tagValue, level:'warning'} )
        }
    }

    protected parse(data:string,workout:Workout):Promise<Workout> {
        return new Promise( (resolve,reject) =>  {    

            let tag
            parser.parseString(data, (err:Error,result)=> {
                if (err) {
                    err.message = 'File contains error(s): '+ err.message.replace(/\n/g,' ');
                    this.logger.logEvent( {message: 'error', fn:'parse()', error: err.message, stack: err.stack})
                    return reject(err);
                }

                try {

                    this.context = {}

                    const zwoSteps = result.workout_file.workout[0].$$ ?? []

                    const ftpOverride = result.workout_file.ftpOverride?.[0] ?? -1;                    
                    if (ftpOverride!==-1) {
                        this.context.ftpOverride = Number(ftpOverride)
                    }

                    zwoSteps.forEach( step => {
                        const tagName = step['#name'];
                        const tagValue = step.$;

                        tag = {name:tagName,...tagValue}
                        const s = this.handleTag(tagName,tagValue);
                        if ( s!==undefined) {
                            if ( s.segment!==undefined)
                                workout.addSegment(s.segment)
                            if ( s.step!==undefined)
                                workout.addStep(s.step)
                        }
                    })
                    

                    resolve(workout)
                }
                catch ( err) {
                    this.logger.logEvent( {message: 'error', fn:'parse()', error: err.message, tag, stack: err.stack})
                    reject( new Error( `parsing error: ${err.message}` ))
                }
            });    
            
        });

    }
 
}