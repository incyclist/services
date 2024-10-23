import { EventLogger } from "gd-eventlog";
import { valid } from "../../utils/valid";
import { ActivityDetails, ActivityLogRecord, ActivityStats } from "../base";
import clone from "../../utils/clone";

/**
 * returns the average of the values of an Array
 * ignores any null or undefined value that might reside in the array
 *
 * @param {Object[]}  arr - Array containing Objects 
 * @param {string}  [key] - The key of the Object value we want to build the average of. If not provided, we assume that the Array is an arry of numbers
 * 
 * @example
 *   const avg = average( [ {a:1,b:2},{a:3,b:6},{a:5,b:10}],'a')  // returns 3;
 *   const avg = average( [ 1,3,5] )  // returns 3;
 */
export function average (arr,key?:string)  {
    if ( !valid(arr) || !Array.isArray(arr))
        return;
    
    if ( key===undefined) {
        let cnt = 0;
        const avgData = arr.reduce( ( p, c ) =>  {
            let res = p;
            if (c!==undefined) {
                res = p + c;
                cnt++;
            }
            return res;
        }, 0 );
        
        if ( cnt>0) return avgData/ cnt;
        return undefined;
    }
    return average( arr.map( el => el ? el[key]: undefined) )
} 

type PowerCurveValue = {
    sum: number
    duration?: number
    avg?: number
}
type PowerCurveLog = {
    input:Record<string,PowerCurveValue>
}

type PowerCurveLogs= Array<PowerCurveLog&ActivityLogRecord>

export class ActivityStatsCalculator {

    
    protected activity:ActivityDetails
    protected statsTemp
    protected powerCurveInput:PowerCurveLogs = []
    protected statsInput: ActivityStats
    protected logger:EventLogger

    constructor(  acitvity:ActivityDetails, logger?:EventLogger) {
        this.activity = acitvity
        this.logger = logger ?? new EventLogger( 'ActivityStats')
    }

    add(logRecord:ActivityLogRecord) {
        try {
            if (this.logs.length===0 || this.statsInput===undefined)
                this.resetStats()

            this.updateStats(logRecord)
            this.addPowerCurveRecord(logRecord)
            this.activity.stats = this.createStats()
            
        }
        catch(err) {
            this.logger.logEvent({message:'error', fn:'add',error:err.message, stack:err.stack})
        }
    }

    addPowerCurve() {

        this.powerCurveInput.forEach( (logRecord,idx) => {
            this.calculatePowerCurveValues(logRecord,idx)
        })
        this.activity.stats = this.createStats()
        this.activity.stats.powerCurve = this.createPowerCurveStats()
    }


    protected updateStatVal ( propName:string, value:number, t:number, inclWeighted=false) {
		if (value===undefined || !t) {
            return;
        }
        
        const prop = this.statsInput[propName];
        prop.cntVal+=t;
        prop.sum+=value*t;
        
        
        this.addMinValue(prop, value);
        this.addMaxValue(prop, value);
        this.addAverage(prop);
        
        if (inclWeighted) {
            this.addWeightedAverages(propName, value, prop);    
        }           
                   
	}

    protected addMinValue(prop: any, value: number) {
        if (prop.min === undefined || value < prop.min) {
            if (prop.minAllowed === undefined || value > prop.minAllowed)
                prop.min = value;
        }
    }

    protected addMaxValue(prop: any, value: number) {
        if (prop.max === undefined || value > prop.max) {
            prop.max = value;
        }
    }

    private addAverage(prop: any) {
        if (prop.cntVal > 0) {
            prop.avg = prop.sum / prop.cntVal;
        }
    }

    protected addWeightedAverages(propName: string, value: number, prop: any) {
        if (this.statsTemp === undefined) {
            this.statsTemp = {};
        }

        if (this.statsTemp[propName] === undefined) {
            this.statsTemp[propName] = { values: [value], cnt: 0, sum: 0 };
        }
        else {
            if (this.statsTemp[propName].values.length >= 30) {
                this.statsTemp[propName].values.shift();
            }
            this.statsTemp[propName].values.push(value);
        }

        const avg = average(this.statsTemp[propName].values);

        this.statsTemp[propName].cnt++;
        this.statsTemp[propName].sum += Math.pow(avg, 4);

        prop.weighted = Math.pow(this.statsTemp[propName].sum / this.statsTemp[propName].cnt, 1 / 4);
    }


    protected get logs():Array<ActivityLogRecord> {
        return this.activity.logs
    }

    protected get stats() {
        return this.activity.stats
    }
    protected set stats(newValue: ActivityStats) {
        this.activity.stats = newValue
    }

    protected resetStats() {
        
		this.statsInput = {
			hrm : { min:undefined, max:undefined, avg: undefined, cntVal:0, sum:0, minAllowed:30},
			cadence : { min:undefined, max:undefined, avg: undefined, cntVal:0, sum:0, minAllowed:1},
			speed : { min:undefined, max:undefined, avg: undefined, cntVal:0, sum:0, minAllowed:1},
			slope : { min:undefined, max:undefined, avg: undefined, cntVal:0, sum:0},
			power : { min:undefined, max:undefined, avg: undefined, weighted:undefined, cntVal:0, sum:0,  minAllowed:25}
        }; 
    }

    protected updateStats(logRecord:ActivityLogRecord) {
        this.updateStatVal( 'hrm',  logRecord.heartrate, logRecord.timeDelta);
		this.updateStatVal( 'speed',  logRecord.speed, logRecord.timeDelta);
		this.updateStatVal( 'slope',  logRecord.slope, logRecord.timeDelta);
		this.updateStatVal( 'power',  logRecord.power, logRecord.timeDelta,true);
        this.updateStatVal( 'cadence',  logRecord.cadence, logRecord.timeDelta); 
    }     

    protected addPowerCurveRecord(logRecord:ActivityLogRecord) {
        const durations = [ 1,2,5,10,30,60,120,300,600,1200,3600,7200]
       
        const input = {}
        durations.forEach( duration=> {
            const d = duration.toString()
            input[d] = {
                sum:0,
                duration:0,
                avg:undefined
            }            
        })
        this.powerCurveInput.push( {...logRecord,input})
    }

    protected calculatePowerCurveValues(logRecord,idx) {
        const durations = [ 1,2,5,10,30,60,120,300,600,1200,3600,7200]
       
        this.powerCurveInput.forEach( (log,i) => {
            if (i>idx)
                return;
            durations.forEach( duration=> {
                const d = duration.toString()
                const data = log.input[d]
                if (data.duration>=duration)
                    return;

                if (data.duration+logRecord.timeDelta<=duration) {
                    data.duration+=logRecord.timeDelta
                    data.sum+=(logRecord.power*logRecord.timeDelta)

                }
                else {
                    data.duration += duration
                    data.sum+=(logRecord.power*duration)

                }
                if (data.duration>=duration) {
                    data.avg = data.sum/data.duration
                }
                
            })
        })
    }

    protected createPowerCurveStats() {

        const durations = [ 1,2,5,10,30,60,120,300,600,1800,3600,7200]

        const powerCurve = {}
    
        durations.forEach( duration=> {
            const t = duration.toString()
            let values = this.powerCurveInput.map( i=>  {
                const l = i.input
                if (!l)
                    return 
                return l[t]?.avg
            })

            values = values.filter(v=>v!==undefined)
            if (values?.length>0)
                powerCurve[t] = Math.max(...values)
       })
    
        return powerCurve;      

    }

    protected createStats() {
        const stats = clone(this.statsInput)
        const keys = ['hrm', 'speed', 'slope','power','cadence']
        keys.forEach(element => {
            delete stats[element].cntVal
            delete stats[element].sum
            delete stats[element].minAllowed
            
        });
        return stats

    }

}