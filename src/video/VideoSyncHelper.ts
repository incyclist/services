import { IncyclistService } from "../base/service";
import { Observer } from "../base/types";
import { Route } from "../routes/base/model/route"
import { RLVActivityStatus, RLVPlaybackStatus } from "./types"


const MIN_PLAYBACK_RATE = 0.0625
const MAX_PLAYBACK_RATE = 16.0
const MAX_DELTA = 200;
const MAX_RATE_UPDATE = 500

const n = (v,i) => isNaN(v)||v===undefined ? '-' : Number(v.toFixed(i))
const f = (v) => n(v,0)


export class VideoSyncHelper extends IncyclistService{

    protected rlvStatus: RLVPlaybackStatus
    protected activityStatus: RLVActivityStatus
    protected rlvPrev: RLVPlaybackStatus
    protected activityPrev: RLVActivityStatus
    protected isPaused: boolean

    protected route: Route
    protected loopMode: boolean

    protected observer: Observer
    protected maxRate: number
    protected maxSuccessRate: number
    protected tsLastIssue: number
    protected bufferedTime: number
    protected tsLastRateIncrease: number
    


    constructor (route:Route, startPos:number, props?:{loopMode?:boolean, observer?:Observer}) {
        super('VideoSync')
        this.route = route;

        this.rlvStatus= {
            ts: Date.now(),
            rate:0,
            time: this.getVideoTimeByPosition(startPos),
            routeDistance:startPos,
            speed:this.getMappingByDistance(startPos)?.videoSpeed,
            lap:1,
        }

        this.activityStatus= {
            ts: Date.now(),            
            routeDistance:startPos,
            speed:0,
            lap:1,
        }

        this.loopMode = props?.loopMode ?? this.route.description.isLoop 
        this.observer = props?.observer
        this.isPaused = true
        this.maxRate = MAX_PLAYBACK_RATE
        this.maxSuccessRate = 0

        this.validateMappings(route)
    }

    pause() {
        this.logEvent({message:'video paused'})
        this.isPaused = true
        this.send('rate-update',0)
    }

    resume() {
        this.logEvent({message:'video resumed'})
        this.isPaused = false
    }

    setBufferedTime(time:number) {
        this.bufferedTime = time
    }

    onVideoPlaybackUpdate(time:number,rate:number,e:{readyState?:number, networkState?:number, bufferedTime?:number} ) {

        if (e.bufferedTime!==undefined) {
            this.setBufferedTime(e.bufferedTime)
        }

        
        if ( e.readyState<3 || (e.networkState!==1&&e.networkState!==2)  ) {
            this.logEvent({message:'video playback issues',time,rate:n(rate,2),bufferedTime:n(this.bufferedTime,1),readyState:e.readyState,networkState:e.networkState})
            
            
            if (this.maxRate===this.maxSuccessRate) {
                this.maxSuccessRate= Math.max(this.maxSuccessRate-0.1, MIN_PLAYBACK_RATE)
            }
            this.maxRate = this.maxSuccessRate
            this.tsLastIssue = Date.now()
            
        }
        else {
            if (rate>this.maxSuccessRate)
                this.maxSuccessRate = rate

            if (this.tsLastIssue!==undefined) {
                const timeSinceLastIssue = (Date.now()-this.tsLastIssue)/1000
                const timeSinceLastRateIncrease = (Date.now()-(this.tsLastRateIncrease??0))/1000
                if (timeSinceLastIssue>10 && this.bufferedTime>1.4 && timeSinceLastRateIncrease>1) {
                    this.maxRate= this.maxSuccessRate +  0.1
                    this.tsLastRateIncrease = Date.now()
                    if (this.maxRate===MAX_PLAYBACK_RATE)
                        delete this.tsLastIssue
                }
            }
        }

        if (this.isPaused) {
            this.rlvStatus.ts = Date.now()
            this.rlvStatus.time = time
            this.rlvStatus.rate = 0
            return
        }

        //console.log('# video playack update',time,rate) 

        this.rlvPrev = {...this.rlvStatus}

        this.rlvStatus.ts = Date.now()
        this.rlvStatus.time = time
        this.rlvStatus.rate = rate

        const mapping = this.getMappingByTime(time)
        if (mapping) {
            this.rlvStatus.routeDistance = this.getPositionByVideoTime(time)
            this.rlvStatus.speed = mapping.videoSpeed
        }       

        let updates:string[] = []

        if (this.rlvStatus.routeDistance>this.rlvPrev.routeDistance) {
            updates.push('rlv:distance')
        }
        else if (this.rlvStatus.routeDistance<this.rlvPrev.routeDistance-100) {
            updates.push('rlv:lap')
            this.rlvStatus.lap++
        }
        if (this.rlvStatus.speed!==this.rlvPrev.speed) {
            updates.push('rlv:speed')
        }

        this.onUpdate(updates)
       
    }

    onActivityUpdate(routeDistance:number,speed:number) {

        if (routeDistance==this.activityStatus.routeDistance && speed==this.activityStatus.speed) {
            return;            
        }

        //console.log('# activtiy update',routeDistance,speed)


        this.activityPrev = {...this.activityStatus}

        const totalDistance = this.route.description.distance
        const distance = Math.max(0, this.loopMode ? routeDistance % totalDistance : Math.min(routeDistance, totalDistance))


        let updates:string[] = []
        if (distance<this.activityStatus.routeDistance-100) {
            updates.push('activity:lap')
            this.activityStatus.lap++
        }
        else if (distance>this.activityStatus.routeDistance) {
            updates.push('activity:distance')
        }
        if (speed!==this.activityStatus.speed) {
            updates.push('activity:speed')
        }
        this.activityStatus.ts = Date.now()
        this.activityStatus.routeDistance = distance
        this.activityStatus.speed = speed           

        this.onUpdate(updates)

    }

    onUpdate( updates:string[]=[] ) {

        try {
            
            const totalDistance = this.route.description.distance

            const sRlv = (source:'rlv' | 'activity') => {
                const tDelta = (source==='rlv' ? Date.now()-this.rlvStatus.ts : Date.now()-this.activityStatus.ts)/1000
                const s0 = source==='rlv' ? this.rlvStatus.routeDistance : this.activityStatus.routeDistance
                const v = source==='rlv' ? this.rlvStatus.speed/3.6*this.rlvStatus.rate : this.activityStatus.speed/3.6
                return s0 + (tDelta)*v            
            }

            let rlvDistance = sRlv('rlv')
            let actDistance = sRlv('activity')

            const log = ()=> {

                const changed = updates.filter( u=>u!=='rlv:distance') 
                if (changed.length===0)
                    return

                console.log('# onUpdate ', {updates:updates.join(','),delta:n(delta,1), bufferedTime:n(this.bufferedTime,1), rlvDistance:f(rlvDistance), actDistance:f(actDistance), rate: n(this.rlvStatus.rate,2), maxRate: n(this.maxRate,2), maxSuccessRate: n(this.maxSuccessRate,2)     })
                this.logEvent({message:'playback update',updates:updates.join(','),delta:n(delta,1), bufferedTime:n(this.bufferedTime,1), rlvDistance:f(rlvDistance), actDistance:f(actDistance), rate: n(this.rlvStatus.rate,2), maxRate: n(this.maxRate,2), maxSuccessRate: n(this.maxSuccessRate,2)  })
            }




            if (updates.includes('rlv:lap')) {
                const time = this.getVideoTimeByPosition(rlvDistance)
                this.updateTime(time)
            }

            if (this.loopMode && this.rlvStatus.lap>this.activityStatus.lap) {
                rlvDistance = rlvDistance + totalDistance
            }
            else if (this.loopMode && this.rlvStatus.lap<this.activityStatus.lap) {
                actDistance =  actDistance + totalDistance
            }

            const delta = rlvDistance-actDistance

            log()

            if (delta===0) {
                if (updates.includes('activity:speed') || updates.includes('rlv:speed')) {
                    const rate = this.rlvStatus.speed ? this.activityStatus.speed/this.rlvStatus.speed : 1
                    this.updateRate(rate)
                }
                return
            }


            const tTarget = 5 // aim is to reach delta=0 in 5 seconds
            const rate=(this.activityStatus.speed-delta/tTarget*3.6)/this.rlvStatus.speed
            this.updateRate(rate)


        }
        catch(err) {
            console.log('# ERROR',err)
            this.logError(err,'onUpdate')
            
        }


    }

    updateRate(requested:number) {

        const rate = Math.max(0, Math.min(requested, this.maxRate))

        if (this.isPaused && rate>0) {
            this.resume()
        }

        this.send('rate-update', rate)                

    }

    updateTime(time:number) {
        console.log('# time update',time)
        this.send('time-update', time)
    }


    protected send(event, ...args) {       
        if (this.observer)
            this.observer.emit(event,...args)
    }

    getCurrentPlaybackSpeed() {
        const {rate,speed} = this.rlvStatus
        return rate*speed
    }



    /**
     * returns the video time in seconds for a given routeDistance in meters
     * if loopMode is enabled, the routeDistance is wrapped around the total route distance
     * @param routeDistance the route distance in meters
     * @returns the video time in seconds
     */
    getVideoTimeByPosition(routeDistance:number):number {
        try {
            const {points,video} = this.route?.details??{}

            const totalDistance = this.route.description.distance
            const distance = Math.max(0,this.loopMode ? routeDistance % totalDistance : Math.min(routeDistance, totalDistance))

            if (!points?.length || !video?.mappings?.length)
                return 0;

            // end of video reached ? last mapping record represents enf of video
            if ( distance===totalDistance)  {
                return video.mappings[video.mappings.length-1].time
            }

            const mapping = this.getMappingByDistance(routeDistance)
            if (!mapping)   
                return 0

            const s0 = mapping.distance
            const v = mapping.videoSpeed/3.6
            const t = mapping.time +(distance-s0)/v

            if (!isNaN(t) )
                return t
            else {
                console.log('#getVideoTimeByPosition ERROR invalid time', {routeDistance,mapping,mappings:video.mappings, distance, s0, v, t})
                this.logEvent({message:'error', fn:'getVideoTimeByPosition', error:'invalid time', routeDistance,mapping, distance, s0, v, t})
                return 0
            }

        }
        catch(err) {
            this.logError(err,'getVideoTimeByPosition')
            return 0
        }

    }

    getPositionByVideoTime(vt:number):number {

        let time = vt
        const {video} = this.route?.details??{}
        const totalTime = video.mappings[video.mappings.length-1].time
        if (time>totalTime && this.loopMode){
            time = time % totalTime
            console.log('# adjusted time',time)
        }

        const mapping = this.getMappingByTime(time)
        if (time!==vt) {
            console.log('# new mapping',mapping,mapping.time>=time)
        }

        if (!mapping)   
            return 0
        if (mapping.time>=time) {
            return mapping.distance
        }

        const s0 = mapping.distance
        const v = mapping.videoSpeed/3.6
        const t = mapping.time
        const distance = s0 + (time-t)*v
        return distance
    }

    getMappingByDistance(routeDistance:number) {
        const {points,video} = this.route?.details??{}

        const totalDistance = this.route?.description?.distance??0
        const distance = this.loopMode ? routeDistance % totalDistance : Math.min(routeDistance, totalDistance)

        if (!points?.length || !video?.mappings?.length)
            return undefined;
        
        const mappingIdx = video.mappings.findIndex( (m) => m.distance>=distance ) 
        if (mappingIdx===-1)    
            return undefined;
        let mapping = video.mappings[mappingIdx]
        if (mappingIdx>0 && mapping.distance>distance) {
            mapping = video.mappings[mappingIdx-1]            
        }

        return mapping
    }

    getMappingByTime(time:number) {
        const {video} = this.route?.details??{}
        if (!video?.mappings?.length)
            return undefined;

        const totalTime = video.mappings[video.mappings.length-1].time
        if (totalTime<=time) {
            return video.mappings[video.mappings.length-1]
        }

        
        const mappingIdx = video.mappings.findIndex( (m) => m.time>=time ) 
        if (mappingIdx===-1)    
            return undefined;
        let mapping = video.mappings[mappingIdx]
        if (mappingIdx>0 && mapping.time>time) {
            mapping = video.mappings[mappingIdx-1]            
        }

        return mapping
    }

    protected validateMappings(route:Route) {
        const mappings = route?.details?.video?.mappings
        if (!mappings || mappings?.length<2)
            return;

        const first = mappings[0]
        const second = mappings[1]
        
        if (first.distance !== 0) {
            // insert new record into mappings with distance and time=0
            const newMappings = [...mappings]
            newMappings.unshift({distance:0,time:0,videoSpeed:second.videoSpeed})
            route.details.video.mappings = newMappings

        }
            


    }

}