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
    protected isStopped: boolean

    protected route: Route
    protected loopMode: boolean

    protected observer: Observer
    protected maxRate: number
    protected maxSuccessRate: number
    protected tsLastIssue: number
    protected bufferedTime: number
    protected tsLastRateIncrease: number
    protected bufferedTimeIssue: number
    protected bufferedTimePrevIncrease: number

    protected cpuTime: number
    protected tsStart:number

    protected cntWaitingEvents: number
    protected maxDelta: number
    


    constructor (route:Route, startPos:number, props?:{loopMode?:boolean, observer?:Observer}) {
        super('VideoSync')
        this.route = route;

        this.init(startPos, props);
        this.validateMappings(route)
    }

    pause() {
        this.logEvent({message:'video paused', route:this.route.details.title})
        this.isPaused = true
        this.send('rate-update',0)
    }

    resume() {
        if (this.isStopped)
            return;

        this.logEvent({message:'video resumed', route:this.route.details.title})
        this.isPaused = false
    }

    reset() {
        this.logEvent({message:'video reset', route:this.route.details.title})
        this.init(0,{loopMode: this.loopMode, observer: this.observer})
    }

    stop() {
        this.logEvent({message:'video stopped', route:this.route.details.title})
        this.send('rate-update',0)
        this.isPaused = true
        this.isStopped = true

        const totalTime = Date.now()-this.tsStart
        this.logEvent({message:'video playback summary', route:this.route.details.title,routeId:this.route.description.id, maxDelta: n(this.maxDelta,1), cntWaiting:this.cntWaitingEvents, totalTime:f(totalTime??0), cpuTime: f(this.cpuTime??0), pct: n(this.cpuTime/totalTime*100,1)})
    }

    setBufferedTime(time:number) {
        
        this.tsStart = this.tsStart ??Date.now()
        
        this.bufferedTime = time
    }

    getRate():number {
        if (this.isPaused || this.isStopped)
            return 0
        return this.rlvStatus.rate
    }

    onVideoEnded() { 
        console.log('# video ended', this.route.details.title)
        this.logEvent({message:'video ended'})
        this.isStopped = true
    }

    onVideoPlaybackUpdate(time:number,rate:number,e:{readyState?:number, networkState?:number, bufferedTime?:number} ) {

        const endTime = this.getVideoTimeByPosition(this.route.distance)


        //console.log('# video playback update', {src: this.route.details.title, time:time, endTime, bufferedTime:e.bufferedTime, stopped:this.isStopped})
        if (this.isStopped)
            return

        if ( time> endTime-0.3 && !this.loopMode && !this.rlvStatus.timeRequested) { 
            this.updateRate(0)
            return
        }

        const tsStart = Date.now()

        this.tsStart = this.tsStart ??Date.now()
        let updates:string[] = []

        if (e.bufferedTime!==undefined) {
            this.setBufferedTime(e.bufferedTime)
        }

        if (time>=this.rlvStatus.timeRequested) {
            //console.log('# new video time confirmed', time, this.rlvStatus.timeRequested)
            delete this.rlvStatus.timeRequested
            delete this.tsLastIssue
            delete this.bufferedTimeIssue 
            this.maxSuccessRate = 1
            this.maxRate = MAX_PLAYBACK_RATE

            updates.push('rlv:time-reset')
        }
        else if (this.rlvStatus.timeRequested && time<this.rlvStatus.timeRequested) {
            //console.log('# waiting for video time', time, this.rlvStatus.timeRequested)
        }

        
        else if (rate===this.rlvStatus.rateRequested)  {
            delete this.rlvStatus.rateRequested 

            if (this.tsLastIssue!==undefined) {
                const timeSinceLastIssue = (Date.now()-this.tsLastIssue)/1000
                const timeSinceLastRateIncrease = (Date.now()-(this.tsLastRateIncrease??0))/1000

                if (timeSinceLastIssue>5 && timeSinceLastRateIncrease>1 && this.bufferedTime>=0.75 ) {

                    this.maxRate= this.maxRate +  0.2
                    this.tsLastRateIncrease = Date.now()
                    this.bufferedTimePrevIncrease = this.bufferedTime
                    
                    if (timeSinceLastIssue>10 && this.bufferedTime>=2.5) {
                        this.maxRate=MAX_PLAYBACK_RATE
                    }
                    
                    if (this.maxRate===MAX_PLAYBACK_RATE) {
                        delete this.tsLastIssue
                        delete this.bufferedTimePrevIncrease
                        delete this.bufferedTimeIssue

                    }

                    //console.log('# video playback issue fixed', this.maxSuccessRate,this.maxRate, timeSinceLastIssue, this.bufferedTime, timeSinceLastRateIncrease)

                }
            }
            if (this.bufferedTime>1) {
                this.maxSuccessRate = Math.max(this.maxSuccessRate, rate)                 
            }
        }
        else {
            //console.log('# rate not confirmed',  this.rlvStatus.rateRequested, rate, this.maxSuccessRate)
        }

        if (this.isPaused) {
            this.rlvStatus.ts = Date.now()
            this.rlvStatus.time = time
            this.rlvStatus.rate = 0
            return
        }

        this.rlvPrev = {...this.rlvStatus}

        this.rlvStatus.ts = Date.now()
        this.rlvStatus.time = time
        this.rlvStatus.rate = rate

        if ( this.isNextLap(time) ) {

            
            const vt = this.getLapTime(time)
            const mapping = this.getMappingByTime(vt)
            if (mapping) {
                this.rlvStatus.routeDistance = this.getPositionByVideoTime(vt)
                this.rlvStatus.speed = mapping.videoSpeed
                this.rlvStatus.lap++
                this.rlvStatus.lapRequested = true
            }       

            //console.log('# new video lap detected', time, this.rlvStatus)
            updates.push('rlv:lap')
            
        }
        else if (time<this.rlvStatus.time && time<10) { // new lap confirmed
            delete this.rlvStatus.lapRequested
        }
        else {
            const vt = this.loopMode ? this.getLapTime(time) : (time>this.getTotalTime() ? this.getTotalTime() : time)
            const mapping = this.getMappingByTime(vt)
            if (mapping) {
                this.rlvStatus.routeDistance = this.getPositionByVideoTime(vt)
                this.rlvStatus.speed = mapping.videoSpeed
            }       
            if (this.rlvStatus.routeDistance>this.rlvPrev.routeDistance) {
                updates.push('rlv:distance')
            }
        }

        if (this.rlvStatus.speed!==this.rlvPrev.speed) {
            updates.push('rlv:speed')
        }

        this.cpuTime = (this.cpuTime??0) + (Date.now()-tsStart)
        this.onUpdate(updates)
       
    }

    onVideoStalled(time:number, bufferedTime:number) {
        // TODO
    }
    onVideoWaiting(time:number, bufferedTime:number) {

        // ignore while we are resetting time
        if (this.rlvStatus.timeRequested || this.rlvStatus.rateRequested)
            return;

        this.cntWaitingEvents++

        if (this.rlvStatus.rateRequested>this.maxSuccessRate) {
            this.maxRate = this.maxSuccessRate    
        }
        else {
            this.maxRate = this.maxSuccessRate =  (this.rlvStatus.rateRequested??1)-0.1
        }

        this.tsLastIssue = Date.now()
        this.bufferedTimeIssue = bufferedTime
        delete this.rlvStatus.rateRequested
        this.onUpdate(['rlv:waiting'])
    }

    onActivityUpdate(routeDistance:number,speed:number) {

        // console.log('# activity update', routeDistance)


        if (routeDistance==this.activityStatus.routeDistance && speed==this.activityStatus.speed) {
            return;            
        }
        if (this.isStopped)
            return

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
        if (this.isStopped || this.rlvStatus.timeRequested)
            return

        try {
            const tsStart = Date.now()
            
            const totalDistance = this.route.description.distance

            const sRlv = (source:'rlv' | 'activity') => {
                const tDelta = (source==='rlv' ? Date.now()-this.rlvStatus.ts : Date.now()-this.activityStatus.ts)/1000
                const s0 = source==='rlv' ? this.rlvStatus.routeDistance : this.activityStatus.routeDistance
                const v = source==='rlv' ? this.rlvStatus.speed/3.6*(this.rlvStatus.rate??1) : this.activityStatus.speed/3.6
                return s0 + (tDelta)*v            
            }

            let rlvDistance = sRlv('rlv')
            let actDistance = sRlv('activity')

            if (updates.includes('rlv:lap')) {
                //console.log( '# distance after lap update', rlvDistance, {tDelta:Date.now()-this.rlvStatus.ts, s0:this.rlvStatus.routeDistance, v:this.rlvStatus.speed/3.6},this.rlvStatus )

            }


            const log = ()=> {

                const changed = updates.filter( u=>u!=='rlv:distance') 
                if (changed.length===0)
                    return

                const totalTime = Date.now()-this.tsStart

                //console.log('# onUpdate ', {totalTime:f(totalTime??0), cpuTime: f(this.cpuTime??0), pct: n(this.cpuTime/totalTime*100,1)},{routeDistance: totalDistance}, {updates:updates.join(','),delta:n(delta,1), bufferedTime:n(this.bufferedTime,1), rlvDistance:f(rlvDistance), actDistance:f(actDistance), rate: n(this.rlvStatus.rate,2), maxRate: n(this.maxRate,2), maxSuccessRate: n(this.maxSuccessRate,2)     })
                this.logEvent({message:'video playback update',updates:updates.join('|'),delta:n(delta,1), bufferedTime:n(this.bufferedTime,1), rlvDistance:f(rlvDistance), actDistance:f(actDistance), rate: n(this.rlvStatus.rate,2), maxRate: n(this.maxRate,2), maxSuccessRate: n(this.maxSuccessRate,2)  })
            }

            if (this.loopMode && this.rlvStatus.lap>this.activityStatus.lap) {
                rlvDistance = rlvDistance + totalDistance
            }
            else if (this.loopMode && this.rlvStatus.lap<this.activityStatus.lap) {
                actDistance =  actDistance + totalDistance
            }

            const delta = rlvDistance-actDistance

            if (Math.abs(delta)>Math.abs(this.maxDelta)) {
                this.maxDelta = delta
            }

            log()

            if (!this.rlvStatus.timeRequested) {
                if (Math.abs(delta)>200) {
                    this.updateTime( this.getVideoTimeByPosition(actDistance) )
                }
                else {
                    if (delta===0) {
                        if (updates.includes('activity:speed') || updates.includes('rlv:speed')) {
                            const rate = this.rlvStatus.speed ? this.activityStatus.speed/this.rlvStatus.speed : 1
                            this.updateRate(rate)
                        }
                        this.cpuTime = (this.cpuTime??0) + (Date.now()-tsStart)
                        return
                    }


                    const tTarget = 5 // aim is to reach delta=0 in 5 seconds
                    const maxCorrection = Math.max(20,this.rlvStatus.time<100 ? 15 : this.bufferedTime/2.5*15) // max correction in m withing tTarget
                    const correction = Math.sign(delta)*Math.min(Math.abs(delta),maxCorrection)

                    const rate=(this.activityStatus.speed-correction/tTarget*3.6)/this.rlvStatus.speed
                    this.updateRate(rate)
                    
                }

                 
            }

            this.cpuTime = (this.cpuTime??0) + (Date.now()-tsStart)


        }
        catch(err) {
            console.log('# ERROR',err)
            this.logError(err,'onUpdate')
            
        }


    }

    updateRate(requested:number) {
        if (requested===undefined || isNaN(requested))
            return

        let rate 
        if (this.tsLastIssue!==undefined) {
            const maxTarget = this.bufferedTime>1 ? (this.maxSuccessRate+this.maxRate)/2 : this.maxSuccessRate
            rate = Math.max(0, Math.min(requested, maxTarget))
        }
        else {
            rate = Math.max(0, Math.min(requested, this.maxRate))
        }

        

        if (this.isPaused && rate>0) {
            this.resume()
        }

        this.rlvStatus.rateRequested = rate

        this.send('rate-update', rate)                

    }

    updateTime(time:number) {
        if (this.rlvStatus.timeRequested)
            return


        this.rlvStatus.timeRequested = time
        delete this.rlvStatus.rateRequested
        delete this.tsLastIssue
        delete this.tsLastRateIncrease

        console.log('# time update requested',time)
        this.send('time-update', time)
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

            if (!points?.length || !video?.mappings?.length || distance===0)
                return 0;

            // end of video reached ? last mapping record represents enf of video
            if ( distance===totalDistance)  {
                return video.mappings[video.mappings.length-1].time
            }

            const mapping = this.getMappingByDistance(routeDistance)
            if (!mapping)   
                return 0

            if (mapping.videoSpeed===undefined || mapping.videoSpeed===null) {
                const idx = video.mappings.indexOf(mapping)
                if (idx===video.mappings.length-1) {
                    mapping.videoSpeed = video.mappings[idx-1].videoSpeed??video.mappings[0].videoSpeed
                }
                else {
                    mapping.videoSpeed = video.mappings[idx+1].videoSpeed
                }
            }

            const s0 = mapping.distance
            const v = mapping.videoSpeed/3.6
            const t = mapping.time +(distance-s0)/v

            if (!isNaN(t) )
                return t
            else {
                console.log('#getVideoTimeByPosition ERROR invalid time', {routeId:this.route.description.id,routeDistance,mapping,mappings:video.mappings, distance, s0, v, t})
                this.logEvent({message:'error', fn:'getVideoTimeByPosition', error:'invalid time', routeId:this.route.description.id,routeDistance,mapping, distance, s0, v, t})
                return 0
            }

        }
        catch(err) {
            this.logError(err,'getVideoTimeByPosition')
            return 0
        }

    }
    getPositionByVideoTime(vt:number):number {
        try  {
            let time = vt
            const {video} = this.route?.details??{}
            const totalTime = video.mappings[video.mappings.length-1].time
            if (time>totalTime){
                time = totalTime
            }

            const mapping = this.getMappingByTime(time)

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
        catch(err) {
            this.logError(err,'getPositionByVideoTime',{routeId:this.route.description.id,time:vt})
            return 0
        }

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


    protected init(startPos: number, props: { loopMode?: boolean; observer?: Observer; }) {
        this.rlvStatus = {
            ts: Date.now(),
            rate: 0,
            time: this.getVideoTimeByPosition(startPos),
            routeDistance: startPos,
            speed: this.getMappingByDistance(startPos)?.videoSpeed,
            lap: 1,
        };

        this.activityStatus = {
            ts: Date.now(),
            routeDistance: startPos,
            speed: 0,
            lap: 1,
        };

        this.loopMode = props?.loopMode ?? this.route.description.isLoop;
        this.observer = props?.observer;
        this.isPaused = true;
        this.isStopped = false;
        this.maxRate = MAX_PLAYBACK_RATE;
        this.maxSuccessRate = MIN_PLAYBACK_RATE;

        this.cntWaitingEvents = 0;
        this.maxDelta = 0;
        delete this.tsStart;
        this.cpuTime = 0;
    }


    protected send(event, ...args) {       
        if (this.observer)
            this.observer.emit(event,...args)
    }


    protected isNextLap(vt:number):boolean {
        try  {
            let time = vt

            const {video} = this.route?.details??{}
            const totalTime = video.mappings[video.mappings.length-1].time
            return  (time>totalTime && this.loopMode && !this.rlvStatus.lapRequested)
        }
        catch(err) {
            this.logError(err,'isNextLap')
            return false
        }

    }

    protected getTotalTime():number {
        const {video} = this.route?.details??{}
        return video.mappings[video.mappings.length-1].time        
    }

    protected getLapTime(vt:number):number {
        try  {
            const {video} = this.route?.details??{}
            const totalTime = video.mappings[video.mappings.length-1].time
            return  vt%totalTime
        }
        catch(err) {
            this.logError(err,'getLapTime')
            return vt
        }
        
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