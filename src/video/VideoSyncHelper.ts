import { Observer } from "../base/types";
import { Route } from "../routes/base/model/route"
import { RLVActivityStatus, RLVPlaybackStatus } from "./types"


const MIN_PLAYBACK_RATE = 0.0625
const MAX_PLAYBACK_RATE = 16.0
const MAX_DELTA = 200;
const MAX_RATE_UPDATE = 500

export class VideoSyncHelper {

    protected rlvStatus: RLVPlaybackStatus
    protected activityStatus: RLVActivityStatus
    protected rlvPrev: RLVPlaybackStatus
    protected activityPrev: RLVActivityStatus

    protected route: Route
    protected loopMode: boolean

    protected observer: Observer


    constructor (route:Route, startPos:number, props?:{loopMode?:boolean, observer?:Observer}) {
        
        this.route = route;

        this.rlvStatus= {
            ts: Date.now(),
            rate:0,
            time: this.getVideoTimeByPosition(startPos),
            routeDistance:startPos,
            speed:this.getMappingByDistance(startPos)?.videoSpeed
        }

        this.activityStatus= {
            ts: Date.now(),            
            routeDistance:startPos,
            speed:0
        }

        this.loopMode = props?.loopMode ?? this.route.description.isLoop 
        this.observer = props?.observer
    }

    onVideoPlaybackUpdate(time,rate) {

        this.rlvPrev = {...this.rlvStatus}

        this.rlvStatus.ts = Date.now()
        this.rlvStatus.time = time
        this.rlvStatus.rate = rate

        const mapping = this.getMappingByTime(time)
        if (mapping) {
            this.rlvStatus.routeDistance = this.getPositionByVideoTime(time)
            this.rlvStatus.speed = mapping.videoSpeed
        }       

        this.onUpdate()
       
    }

    onActivityUpdate(routeDistance:number) {

        this.activityPrev = {...this.activityStatus}

        const totalDistance = this.route.description.distance
        const distance = Math.max(0,this.loopMode ? routeDistance % totalDistance : Math.min(routeDistance, totalDistance))

        this.activityStatus.ts = Date.now()
        this.activityStatus.routeDistance = distance
        const mapping = this.getMappingByDistance(routeDistance)
        if (mapping) {
            this.activityStatus.speed = mapping.videoSpeed            
        }

        this.onUpdate()

    }

    onUpdate() {
        const tsDelta = this.activityStatus.ts - this.rlvStatus.ts

        const sRlv = (source:'rlv' | 'activity',tDelta) => {
            const s0 = source==='rlv' ? this.rlvStatus.routeDistance : this.activityStatus.routeDistance
            const v = source==='rlv' ? this.rlvStatus.speed/3.6 : this.activityStatus.speed/3.6
            return s0 + (tDelta)*v            
        }

        const rlvDistance = tsDelta<=0 ? this.rlvStatus.routeDistance : sRlv('rlv',tsDelta/1000)
        const actDistance = tsDelta<=0 ? this.rlvStatus.routeDistance : sRlv('activity',-tsDelta/1000)

        const delta = rlvDistance-actDistance

        if (delta===0) {
            if (this.rlvPrev.speed!==this.rlvStatus.speed) {
                const rate = this.rlvStatus.speed ? this.activityStatus.speed/this.rlvStatus.speed : 1
                this.emit('rate-update', rate)                
            }
            return
        }

        if (delta>0) { // video is playing faster than current cyclist

        }
        
        

    }

    protected emit(event, ...args) {
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
        return t

    }

    getPositionByVideoTime(time:number):number {
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

}