import { IncyclistService } from "../base/service";
import { Observer } from "../base/types";
import { RouteApiDetail } from "../routes/base/api/types";
import { Route } from "../routes/base/model/route"
import { RLVActivityStatus, RLVPlaybackStatus } from "./types"
import { v4 as generateUUID } from 'uuid';


const MIN_PLAYBACK_RATE = 0.0625
const MAX_PLAYBACK_RATE = 16.0
const MAX_DELTA = 200;
const MAX_RATE_UPDATE = 500
const MAX_FWD_FREQ = 60*1000    // once per minute

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
    protected id:string
    protected tsLastSummeryLog:number
    protected mapping: any
    protected endTime: number

    protected prevDelta: number
    


    constructor (route:Route, startPos:number, props?:{loopMode?:boolean, observer?:Observer}) {
        super('VideoSync')
        this.route = route;

        this.validateMappings(route)
        this.initCorrectedMapping(this.route?.details)        
        this.init(startPos, props);
    }

    logEvent(event: any): void {
        if (!event)
            return

        const route = this.route?.details?.title        
        const syncId = this.id
        const logEvent = { message:event.message,route, syncId, ...event }
        super.logEvent(logEvent)
    }

    pause() {
        this.logEvent({message:'video paused'})
        this.logPlaybackSummary()
        this.isPaused = true
        this.send('rate-update',0)
        this.activityStatus.ts = Date.now()
        this.rlvStatus.ts = Date.now()

    }

    resume() {
        if (this.isStopped)
            return;

        this.logEvent({message:'video resumed'})
        this.isPaused = false
        this.activityStatus.ts = Date.now()
        this.rlvStatus.ts = Date.now()
    }

    reset() {
        this.logEvent({message:'video reset'})
        this.init(0,{loopMode: this.loopMode, observer: this.observer})
        delete this.endTime
    }

    stop() {
        this.logEvent({message:'video stopped'})
        this.send('rate-update',0)
        this.isPaused = true
        this.isStopped = true

        delete this.endTime
        delete this.prevDelta
        this.logPlaybackSummary()
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
        this.logEvent({message:'video ended'})
        this.isStopped = true
    }

    onVideoPlaybackUpdate(time:number,rate:number,e:{readyState?:number, networkState?:number, bufferedTime?:number} ) {

        try {
            this.endTime = this.endTime ?? this.getVideoTimeByPosition(this.route.description?.distance)
            const endTime = this.endTime


            if (this.isStopped || this.isPaused)
                return

            if ( time> endTime-0.3 && !this.loopMode && !this.rlvStatus.timeRequested) { 
                this.updateRate(0)
                return
            }

            const tsStart = Date.now()
            this.rlvPrev = {...this.rlvStatus}

            this.tsStart = this.tsStart ??Date.now()
            let updates:string[] = []

            if (e.bufferedTime!==undefined) {
                this.setBufferedTime(e.bufferedTime)
            }

            if (this.rlvStatus.timeRequested!==undefined && time>=this.rlvStatus.timeRequested) {
                delete this.rlvStatus.timeRequested
                delete this.tsLastIssue
                delete this.bufferedTimeIssue 
                this.maxSuccessRate = 1
                this.maxRate = MAX_PLAYBACK_RATE
                this.logEvent({message:'video forwarded', time})
                
                updates.push('rlv:time-reset')
            }
            else if (this.rlvStatus.timeRequested!==undefined && time<this.rlvStatus.timeRequested) {
                //console.log('# waiting for video time', time, this.rlvStatus.timeRequested)
            }

            
            else if (this.rlvStatus.rateRequested!==undefined && rate>=this.rlvStatus.rateRequested)  {
                delete this.rlvStatus.rateRequested 
                delete this.rlvStatus.tsLastRateRequest

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
            else if (this.rlvStatus.rateRequested!==undefined && (Date.now()-(this.rlvStatus.rateRequested??0)>2000)) {          
                delete this.rlvStatus.rateRequested
                delete this.rlvStatus.rateRequested
                this.logEvent({message:'video rate update timeout'})
                
            }

            this.checkIfStalledEnded(time)

            if (this.isPaused) {
                this.rlvStatus.ts = Date.now()
                this.rlvStatus.time = time
                this.rlvStatus.rate = 0
                return
            }

            const prevTime = this.rlvPrev.time

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

                updates.push('rlv:lap')
                
            }           
            else {
                if (this.rlvStatus.lapRequested && time<prevTime && time<10) { // new lap confirmed
                    delete this.rlvStatus.lapRequested
                }

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
        catch(err) {
            this.logError(err,'onVideoPlaybackUpdate')            

        }


       
    }

    onVideoStalled(time:number, _bufferedTime:number) {
        this.logEvent({message:'video stalled', time, source:'event'})
        this.rlvStatus.isStalled = true
    }
    onVideoWaiting(time:number, rate:number, bufferedTime:number,buffers:Array<{start:number,end:number}>) {
        this.logEvent({message: 'video waiting',time, bufferedTime,buffers})

        // ignore while we are resetting time
        if (this.rlvStatus.timeRequested ) {
            return;
        }

        this.cntWaitingEvents++

        // rate was requested might have caused the waiting event (too fast)
        if (this.rlvStatus.rateRequested) {
            if (this.rlvStatus.rateRequested>this.maxSuccessRate) { // we are beyond the fastest confirmed playback rate
                this.maxRate = this.maxSuccessRate    
            }
            else {  // we are less or equal the fastest confirmed playback rate
                // reduce maximum allowed rate for next updates
                this.maxRate = Math.min(1,this.rlvStatus.rateRequested-0.1)
            }
        }

        this.tsLastIssue = Date.now()
        this.bufferedTimeIssue = bufferedTime
        delete this.rlvStatus.rateRequested
        this.rlvStatus.rate = rate

        //this.onUpdate(['rlv:waiting'])
    }

    onActivityUpdate(routeDistance:number,speed:number) {

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
        
        this.checkIfStalled()

        this.onUpdate(updates)

    }

    onUpdate( updates:string[]=[] ) {
        if (this.isStopped  || this.rlvStatus.timeRequested)
            return
        if (!updates?.length)
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


            const canLog = ()=> {
                const changed = updates.filter( u=>u!=='rlv:distance') 
                return (changed.length>0 || Date.now()-(this.rlvStatus.tsVideoUpdate??0)>1000) 
            }
            const isNewVideoUpdate = ()=> {
                if (!canLog())
                    return false
                return updates.some( u=>u.startsWith('rlv'))
            }

            const log = ()=> {
                if (!canLog())
                    return

                // add debug info if delta is large
                let debug={}                
                if (Math.abs(delta)>1000) { 
                    const mapping = this.getMappingByTime(this.rlvStatus.time) 
                    const tDelta = (Date.now()-this.rlvStatus.ts) /1000
                    const s0 = this.rlvStatus.routeDistance 
                    const v = this.rlvStatus.speed/3.6*(this.rlvStatus.rate??1) 
                    debug = {mapping, tDelta, s0, v}

                }

                // add debug info if no valid rlv distance is available
                if (f(rlvDistance)==='-') {
                    debug = { ...debug, rlvStatus:this.rlvStatus, activityStatus: this.activityStatus }
                }
                this.logEvent({message:'video playback update',updates:updates.join('|'),delta:n(delta,1), bufferedTime:n(this.bufferedTime,1), rlvDistance:f(rlvDistance), actDistance:f(actDistance), 
                                    rlvTime: n(this.rlvStatus?.time,2),rate: n(this.rlvStatus.rate,2), maxRate: n(this.maxRate,2), maxSuccessRate: n(this.maxSuccessRate,2),...debug  })

            }

            if (this.loopMode && actDistance>totalDistance) {
                actDistance = actDistance % totalDistance
                rlvDistance = rlvDistance % totalDistance
            }


            let delta = rlvDistance-actDistance
            if (this.loopMode) {
                const deltaActAhead = rlvDistance-(actDistance+totalDistance)
                const deltaRlvAhead = (rlvDistance+totalDistance)-actDistance
                // get the value with the lowest abs value from delta, deltaActAhead and deltaRlvAhead                
                delta = [delta, deltaActAhead, deltaRlvAhead].reduce((best, cur) => Math.abs(cur) < Math.abs(best) ? cur : best, delta)        
            }

            if (Math.abs(delta)>Math.abs(this.maxDelta)) {
                this.maxDelta = delta
            }

            log()

            if (isNewVideoUpdate()) {
                this.rlvStatus.tsVideoUpdate = Date.now()
            }

            
            if (!this.rlvStatus.timeRequested && Date.now()-(this.rlvStatus.tsLastTimeRequest??0)>MAX_FWD_FREQ) {

                if ( Math.abs(delta)>MAX_DELTA ) {


                    const newTime = this.getVideoTimeByPosition(actDistance) 
                    if (newTime-this.rlvStatus.time>1) {
                        this.logEvent({message:'video forward requested', newTime})
                        this.updateTime( newTime)
                        this.prevDelta = delta
                    }
                    else {
                        const time = this.rlvStatus.time
                        const vt = this.loopMode ? this.getLapTime(time) : (time>this.getTotalTime() ? this.getTotalTime() : time)
                        const mapping = this.getMappingByTime(vt)

                        this.logEvent({message:'video forwarded skipped', 
                            newTime,rlvTime:this.rlvStatus.time,rlvSpeed:this.rlvStatus.speed, rate:this.rlvStatus.rate,
                            routeDistance:this.rlvStatus.routeDistance, tDelta:Date.now()-this.rlvStatus.ts,
                            mapping
                        })
                    }
                }
                else {
                    this.prevDelta = delta
                    if (delta===0) {
                        if (updates.includes('activity:speed') || updates.includes('rlv:speed') ) {
                            const rate = this.rlvStatus.speed ? this.activityStatus.speed/this.rlvStatus.speed : 1
                            this.updateRate(rate)
                        }
                        this.cpuTime = (this.cpuTime??0) + (Date.now()-tsStart)
                        return
                    }


                    const tTarget = 5 // aim is to reach delta=0 in 5 seconds
                    const maxCorrection = Math.max(20,this.rlvStatus.time<100 ? 15 : (this.bufferedTime??0)/2.5*15) // max correction in m withing tTarget
                    const correction = Math.sign(delta)*Math.min(Math.abs(delta),maxCorrection)

                    const rate=(this.activityStatus.speed-correction/tTarget*3.6)/this.rlvStatus.speed
                    this.updateRate(rate)
                    
                }

                 
            }
        

            this.cpuTime = (this.cpuTime??0) + (Date.now()-tsStart)


        }
        catch(err) {
            this.logError(err,'onUpdate')
            
        }


    }

    updateRate(requested:number) {
        if (requested===undefined)
            return
        if (isNaN(requested)) {
            delete this.rlvStatus.rateRequested
            return
        }

        if (!this.isPaused && !this.isStopped && this.rlvStatus.rate!==undefined && Math.abs(requested-this.rlvStatus.rate)<0.01)  {
            delete this.rlvStatus.rateRequested
            return;
        }

        let rate 
        if (this.tsLastIssue!==undefined) {
            const maxTarget = this.bufferedTime>1 ? (this.maxSuccessRate+this.maxRate)/2 : this.maxSuccessRate
            rate = Math.max(0, Math.min(requested, maxTarget))
        }
        else {
            rate = Math.max(0, Math.min(requested, this.maxRate))
        }

        this.logEvent({message:'video rate update requested', rate:Math.round(rate*100)/100})
        

        if (this.isPaused && rate>0) {
            this.resume()
        }
        else if (this.isPaused && rate===0) {
            delete this.rlvStatus.rateRequested
            return
        }

        this.rlvStatus.rateRequested = rate
        this.rlvStatus.tsLastRateRequest = Date.now()
        this.send('rate-update', rate)                

    }

    updateTime(time:number) {
        if (this.rlvStatus.timeRequested)
            return


        this.rlvStatus.timeRequested = time
        this.rlvStatus.ts = Date.now()
        delete this.rlvStatus.rateRequested
        delete this.rlvStatus.tsLastRateRequest
        delete this.tsLastIssue
        delete this.tsLastRateIncrease

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
            const mappings = this.mapping

            const totalDistance = this.route.description.distance
            const distance = Math.max(0,this.loopMode ? routeDistance % totalDistance : Math.min(routeDistance, totalDistance))

            if (!mappings?.length || distance===0) {
                return 0;
            }

            // end of video reached ? last mapping record represents enf of video
            if ( distance===totalDistance)  {
                return mappings[mappings.length-1].time
            }

            const mapping = this.getMappingByDistance(routeDistance)
            if (!mapping)   {
                return 0
            }

            if (mapping.videoSpeed===undefined || mapping.videoSpeed===null) {
                const idx = mappings.indexOf(mapping)
                if (idx===mappings.length-1) {
                    mapping.videoSpeed = mappings[idx-1].videoSpeed??mappings[0].videoSpeed
                }
                else {
                    mapping.videoSpeed = mappings[idx+1].videoSpeed
                }
            }

            const s0 = mapping.distance
            const v = mapping.videoSpeed/3.6
            const t = mapping.time +(distance-s0)/v

            if (!Number.isNaN(t) ) {
                return t
            }
            else {
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
            const mappings = this.mapping


            const totalTime = mappings[mappings.length-1].time
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
            this.logError(err,'getPositionByVideoTime',{routeId:this.route.description.id,time:vt, mappings:this.mapping})
            return 0
        }

    }

    getMappingByDistance(routeDistance:number) {

        const {points} = this.route?.details??{}

        const mappings = this.mapping
        const totalDistance = this.route?.description?.distance??0
        const distance = this.loopMode ? routeDistance % totalDistance : Math.min(routeDistance, totalDistance)

        if (!points?.length || !mappings?.length)
            return undefined;
        
        const mappingIdx = mappings.findIndex( (m) => m.distance>=distance ) 
        if (mappingIdx===-1)    
            return undefined;
        let mapping = mappings[mappingIdx]
        if (mappingIdx>0 && mapping.distance>distance) {
            mapping = mappings[mappingIdx-1]            
        }

        return mapping
    }

    getMappingByTime(time:number) {

        const mappings = this.mapping
        if (!mappings?.length)
            return undefined;

        const totalTime = mappings[mappings.length-1].time
        if (totalTime<=time) {
            return mappings[mappings.length-1]
        }

        
        const mappingIdx = mappings.findIndex( (m) => m.time>=time ) 
        if (mappingIdx===-1)    
            return undefined;
        let mapping = mappings[mappingIdx]
        if (mappingIdx>0 && mapping.time>time) {
            mapping = mappings[mappingIdx-1]            
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
        this.id = generateUUID()
    }


    protected send(event, ...args) {       
        if (this.observer)
            this.observer.emit(event,...args)
    }


    protected isNextLap(vt:number):boolean {
        try  {
            let time = vt
            const totalTime = this.mapping[this.mapping.length-1].time
            return  (time>totalTime && this.loopMode && !this.rlvStatus.lapRequested)
        }
        catch(err) {
            this.logError(err,'isNextLap')
            return false
        }

    }

    protected getTotalTime():number {
        return this.mapping[this.mapping.length-1].time        
    }

    protected getLapTime(vt:number):number {
        try  {
            const totalTime = this.mapping[this.mapping.length-1].time
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

    protected   initCorrectedMapping( routeData:RouteApiDetail) {

        // Some video files contain an incomplete mapping (in extrem case: just one record with constant VideoSpeed)
        // The parsers do not address this
        // But as we need to have the mapping for the whole distance of the video, we need to correct these cases here
        // otherwise the video playback would be "stuttering"

        if (!routeData?.video?.mappings || !Array.isArray(routeData.video.mappings)) {
            return;
        }

        const mappings = routeData.video.mappings;
        const totalDistance = routeData.distance;
        const framerate = routeData.video.framerate
        
        const newMappings = [...mappings]
        this.mapping = newMappings

        let lastRecord = newMappings[newMappings.length-1]
        let error

        // if the mappings do not cover the full distance, fill up with records containing constant speed (every 1s)
        while (lastRecord.distance<totalDistance && lastRecord.videoSpeed && !error) {
            try {
                let time = Math.floor(lastRecord.time)+1
                const t = time-lastRecord.time
                const v = lastRecord.videoSpeed/3.6
                const s = v*t
                let distance = lastRecord.distance + s

                if (distance>totalDistance) {
                    const s = totalDistance-lastRecord.distance
                    const t = s/v
                    time = lastRecord.time+t
                    distance = totalDistance

                }          
                const frame =   Math.round(time*framerate)
                newMappings.push({...lastRecord, frame, time, distance})
            }
            catch(err) {
                error = err
            }
            lastRecord = newMappings[newMappings.length-1]
        }

        return newMappings;
    }


    protected logPlaybackSummary() {
        // if previous log was done within last minute, don't log again
        if (Date.now()-(this.tsLastSummeryLog??0)<60000)
            return;

        const totalTime = Date.now()-this.tsStart
        this.logEvent({message:'video playback summary', routeId:this.route.description.id, maxDelta: n(this.maxDelta,1), cntWaiting:this.cntWaitingEvents, totalTime:f(totalTime??0), cpuTime: f(this.cpuTime??0), pct: n(this.cpuTime/totalTime*100,1)})
        this.tsLastSummeryLog = Date.now()

    }

    protected checkIfStalled() {
        if ( this.rlvStatus.tsVideoUpdate===undefined )
            return 

        const timeSinceLastUpdate = Date.now()-this.rlvStatus.tsVideoUpdate
        if (timeSinceLastUpdate>2000 && !this.rlvStatus.isStalled && this.rlvStatus.rate>0.1 && !this.isPaused && !this.isStopped) { 
            this.rlvStatus.isStalled = true
            this.rlvStatus.tsStalled = this.rlvStatus.tsVideoUpdate
            this.logEvent( {message:'video stalled', time:this.rlvStatus.time,source:'timeout' })
        }
    }

    protected checkIfStalledEnded(time:number) {
        if (!this.rlvStatus.isStalled)
            return 

        if (!this.rlvPrev)
            return

        if (time>this.rlvPrev.time) {
            this.rlvStatus.isStalled = false
            const duration = Date.now()-(this.rlvStatus.tsStalled??0)
            delete this.rlvStatus.tsStalled
            this.logEvent( {message:'video playback unstalled', time:this.rlvStatus.time, duration})
        }

    }


}