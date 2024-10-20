import { EventLogger } from 'gd-eventlog';
import { ActivityDetails } from '../base';
import { Route } from '../../routes/base/model/route';
import { checkIsLoop } from '../../routes/base/utils/route';
import { calculateSpeedAndDistance } from '../../utils/calc';


class InfinityError extends Error {
    constructor() {
        super();
        this.message = 'infinite'
    }
}

class TimeoutError extends Error {
    constructor(message) {
        super(message);
        this.message = message || 'timeout'
    }
}


type RemainingTimeProps ={
    route:Route,
    routePos:number,
    power?:number,
    speed?:number
    endPos?:number
}

type RemainingTimeCache ={
    remaining: RemainingInfo
    totalDistance: number;  /** total distance of route(lap) */
    ts: number; /** timestamp when last calculation was done */
}

type RemainingInfo = {
    timeRemaining: number; /** remaining time */
    pos: number; /**  route position */
    timeSinceStart: number;
    speed: number

}

export class ActivityDuration {


    protected activity: ActivityDetails
    protected logger: EventLogger
    protected cache: RemainingTimeCache

    constructor(activity:ActivityDetails) {
        this.activity = activity
        this.logger = new EventLogger('ActivityDuration')
    }


    /**
     * Provides the result of the calculation of the remaining time
     * 
     * As this is called during UI refresh, we need to ensure that this method returns quickly (<5ms)
     * Therefore we will deliver cached values( minus time advanced) in case the calulation takes too long
     * 
     * @param {*} props 
     * @returns 
     */

    getRemainingTime( props:RemainingTimeProps) { 

        try {
            const {route, routePos, power, speed=0,endPos} = props||{}
            const {stats,time=0,user} = this.activity
            const calcPower = stats?.power?.avg || power
            const m = (user.weight||75)+10
            const v = speed/3.6
            const realityFactor = (this.activity.realityFactor??100)/100

            if  ( (routePos>route.distance /* new lap  */) || 
                  (this.cache && this.cache.totalDistance!==route.distance /* route has changed*/)
                ){
                delete this.cache
            }

            if (this.cache) {
                const updateFrequency =time>300 ? 3000 : (time>150 ? 5000: 10000)
                const timeSinceLastUpdate = Date.now()-this.cache.ts;
        
                if (timeSinceLastUpdate<updateFrequency ) {                    
                    const timeRemaining = this.cache.remaining.timeRemaining - (Date.now()-this.cache.ts)/1000        
                    return timeRemaining<0? undefined: timeRemaining
                }
            }
            

            const tsStart = Date.now()
            const res = this.calculateRemainingTime(route, routePos, calcPower,m,v, realityFactor,endPos)

            if (!res || !Array.isArray(res) || res.length===0) {
                return undefined
            }
            
            this.cache = { remaining: res[0], ts:tsStart,  totalDistance:route.distance}
            const timeRemaining = res[0].timeRemaining

            return timeRemaining<0 ? undefined: timeRemaining
        }
        catch(err) {
            this.logger.logEvent({message:'error', error:err.message,fn:'getRemainingTime', stack:err.stack})
            return undefined
        }
    }

    protected calculateRemainingTime(route:Route, routePos:number, power:number,m:number, v:number=0, realityFactor:number=1, endPos?:number):Array<RemainingInfo> {
        
        if (!route)
            return;


        const gpxData = route.points
        const isLap = checkIsLoop(route)
        const lapDistance = isLap ? routePos % route.distance : routePos
        const totalDistance = endPos!==undefined ? endPos : route.distance
       

        // start with 0km/h
        const fromStart = []
        let vPrev = v;
        let timeSinceStart = 0;


        const startDistance = lapDistance
        let segmentStart = startDistance


        try {

            const doCalc = (segmentDistance,slope) => {

                //console.log('~~~ calc',segmentDistance,slope)
                let progress = 0;
                let time = 0;
                //const tsCalcStart = Date.now()

                do {
                    const {speed,distance} = calculateSpeedAndDistance(power,slope,vPrev,m, 1)

                    
                    if (speed===0 || distance===0) {
                        throw new InfinityError()
                    }
                    
                    /*
                    // we need to protect the nodejs timers. If the code here takes longer than a given timeout, then we need to 
                    // throw an exception otherwise, the thread would be blocked
                    const calcTimedOut = (Date.now()-tsCalcStart)>5 //DEFAULT_TIMEOUT_CALC
                    if (calcTimedOut) {
                        throw new TimeoutError(`calc timeout at ${progress} of ${segmentDistance}`)                            
                    }
                    */

                    vPrev = speed/3.6;
                    const prevProgress = progress
                    progress+=distance;
                    if (progress<segmentDistance) 
                        time+=1
                    else {
                        const sDelta = segmentDistance-prevProgress;
                        const t = sDelta >0 ? sDelta/vPrev :0
    
                        time += t;
                        progress = segmentDistance;

                    }

                }
                while ( progress<segmentDistance)


                return {time,step: progress};


            }

            gpxData.forEach( (p,i) => {

                try {
                
                    if (p.routeDistance<startDistance && (i===gpxData.length-1 || gpxData[i+1].routeDistance<startDistance))
                        return;

                    if (endPos!==undefined && p.routeDistance>endPos)
                        return

                    const segmentEnd = i===gpxData.length-1 ? totalDistance : gpxData[i+1].routeDistance;
                    const segmentLength = segmentEnd-segmentStart;
                    const slope = (p.slope||0) * (realityFactor||0)

                    if (segmentLength<=0)
                        return

                    const speed = vPrev*3.6;
                    const {time /*,step*/}= doCalc(segmentLength,slope)

                    fromStart.push( {power, pos:segmentStart, timeSinceStart,routeDistance:p.routeDistance, speed})

                    timeSinceStart+=time;
                    segmentStart = segmentEnd


                }
                catch(err) {
                    if ( err instanceof InfinityError || err instanceof TimeoutError)
                        throw err
                }


            })
            

            
            const totalTime = timeSinceStart
            const remaining = fromStart.map( r => { return {pos:r.pos, timeRemaining: totalTime-r.timeSinceStart, timeSinceStart:r.timeSinceStart,speed:r.speed}})

 
            return remaining;
            
    
        }
        catch(err) {
            return undefined
        }


    }

}