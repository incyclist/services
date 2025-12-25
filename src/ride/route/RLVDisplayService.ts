import { ActivityUpdate } from "../../activities/ride/types";
import { Injectable } from "../../base/decorators";
import { Observer } from "../../base/types";
import { LocalizationService, useLocalization } from "../../i18n";
import { concatPaths } from "../../maps/MapArea/utils";
import { getNextVideoId, hasNextVideo, RouteListService, useRouteList, validateRoute } from "../../routes";
import { Route } from "../../routes/base/model/route";
import { RouteInfoText } from "../../routes/base/types";
import { VideoConversion, VideoSyncHelper } from "../../video";
import { CurrentPosition, CurrentRideDisplayProps, InfotextDisplayProps, OverlayDisplayProps, RLVDisplayProps, VideoDisplayProps } from "../base";
import { RouteDisplayService } from "./RouteDisplayService";

type VideoState = {
    observer?: Observer
    id?:string,
    source?: string|VideoConversion
    error?: string
    playback?: 'native' | 'converted'
    loaded?: boolean
    route?: Route
    syncHelper?: VideoSyncHelper
    isCurrent: boolean
    isInitial: boolean
    buffering?:string
    bufferTime?: number
    next?: VideoState
    info?: Array<{start:number, stop:number, props:InfotextDisplayProps}>
}

export class RLVDisplayService extends RouteDisplayService {

    protected currentVideo: VideoState
    protected videos: Array<VideoState>
    protected offset: number
    protected isInitialized: boolean
    protected infotext?: InfotextDisplayProps
    protected videosInitialized: boolean = false
    protected startTime: number

    
    


    constructor() {
        super()        
        this.isInitialized = false
    }

    initView(): void {
        this.currentVideo = undefined
        this.videos = []
        delete this.startTime

        this.addVideo(this.getOriginalRoute(), true).then( ()=>{
            this.videosInitialized = true
            this.emit('state-update')
        })

        this.isInitialized = true
        this.offset = 0
    }

    getOverlayProps(overlay, props: CurrentRideDisplayProps):OverlayDisplayProps {
        const res = super.getOverlayProps(overlay, props)

        if (overlay==='map') {
            res.show = this.currentRoute.description.hasGpx
        }
        return res
    }


    protected async addVideo( route:Route, isCurrent?:boolean, parent?:VideoState):Promise<void> {
        try {

            const videoRoute = route.clone()
            const observer = new Observer()
            const video:VideoState = {isCurrent,isInitial:isCurrent,route:videoRoute, loaded:false,observer}

            this.initVideoSource(video)    

            
            const loopMode = isCurrent && this.isLoopEnabled()       
            const startPos = isCurrent ? this.startSettings?.startPos??0 : 0

            if (video.playback==='converted') {
                const conversion = video.source as VideoConversion
                conversion.setStartPos(startPos)

            }

            video.syncHelper = new VideoSyncHelper(videoRoute, startPos,{loopMode,observer} )
            this.videos.push(video)

            if (isCurrent) {
                this.currentVideo = video
            }        

            if (videoRoute.details?.infoTexts?.length > 0) {
                video.info = videoRoute.details.infoTexts.map(info => {
                    const start = video.syncHelper.getVideoTimeByPosition(info.distance)
                    const stop = start+5

                    return {
                        start,
                        stop,
                        props: {
                            text: this.getLocalizedText(info),
                            routeDistance: info.distance
                        }
                    }
                })
            }

            if (parent) {
                parent.next = video
            }

            await this.checkForAdditionalVideos(videoRoute)
                

            const nextId = getNextVideoId(videoRoute)

            this.logEvent({message: 'video added', id: videoRoute.description.id, title: videoRoute.description.title, segmentDistance: videoRoute.description.distance,next:nextId})
        }
        catch (error) {
            this.logError(error,'addVideo')
        }
    }



    pause() {
        super.pause()

        this.currentVideo.syncHelper.pause()


    }


    getDisplayProperties(props: CurrentRideDisplayProps):RLVDisplayProps {
        this.startTime = this.startTime??this.getVideoTime(this.startSettings?.startPos??0)
        const startTime = this.startTime
        const routeProps = super.getDisplayProperties(props)


        if (!this.videosInitialized || !this.currentVideo) {
            return {
                ...routeProps,                
                video: undefined,
                videos: []
            }
        }


        if ( this.videos.length === 1) {
            const autoConvert = this.currentVideo?.playback==='converted'

            const video:VideoDisplayProps = {
                src: this.currentVideo.source,
                startTime,
                autoConvert,
                info:this.getInfotextDisplayProps(),
                muted: true,
                loop: this.isLoopEnabled() ? true : undefined,
                playback: this.currentVideo.playback,
                observer: this.currentVideo.observer,
                onLoaded: this.onVideoLoaded.bind(this),
                onLoadError: this.onVideoLoadError.bind(this),
                onPlaybackError: this.onVideoPlaybackError.bind(this),
                onPlaybackUpdate: this.onVideoPlayBackUpdate.bind(this),
                onStalled: this.onVideoStalled.bind(this),
                onWaiting: this.onVideoWaiting.bind(this),
                onEnded: this.onVideoEnded.bind(this),
                onConvertUpdate: this.onConvertUpdate.bind(this)
            }

            return {
                ...routeProps,
                video
            }    
           
        }
        else {
            const videos: Array<VideoDisplayProps> = this.videos.map(video => {

                const autoConvert = video?.playback === 'converted'

                return {
                    src: video.source,
                    id: video.route?.details?.id,
                    startTime: video.isInitial? startTime: 0,
                    autoConvert,
                    hidden: !video.isCurrent,
                    info:video.isCurrent ? this.getInfotextDisplayProps() : undefined,
                    muted: true,
                    playback: video.playback,
                    observer: video.observer,
                    onLoaded: (bufferedTime: number) => { this.onVideoLoaded(bufferedTime, video) },
                    onLoadError: (error:MediaError) => { this.onVideoLoadError(error,video)},
                    onPlaybackError: (error:MediaError) => { this.onVideoPlaybackError(error,video) },
                    onPlaybackUpdate: (time:number, rate:number,e) => { this.onVideoPlayBackUpdate(time, rate,e,video) },
                    onEnded: () => { this.onVideoEnded(video) }                    
                }
            })
            return {
                ...routeProps,
                videos
            }

        }

        
    }

    protected getInfotextDisplayProps():InfotextDisplayProps {
        return this.infotext 
    }

    protected checkFinishOptions(position:CurrentPosition):boolean {

        if ( this.videos.length === 0 || !this.currentVideo?.loaded) {
            return super.checkFinishOptions(position)
        }

        
        if (!this.currentVideo?.next) {
            return super.checkFinishOptions(position)
        }

        const finished = this.checkIsRouteFinished(position)
        if (finished) {
            this.onNextVideo()
            return false
        }
    }

    protected onNextVideo() { 

        const old = this.currentVideo
        const next = this.currentVideo.next

        if (!next) 
            return

        old.isCurrent = false
        old.isInitial = false

        next.isCurrent = true

        // reset start position for next ride of current video
        this.savePosition(0)

        // prepare next video
        this.offset += old.route.description.distance
        next.syncHelper.updateRate( old.syncHelper.getRate())

        // switch to next video
        this.currentVideo = next

        // stop/reset old video
        old.syncHelper.stop()
        setTimeout(() => {
            // reset for a potential restart
            old.syncHelper.reset()
        }, 2000)

        // update current route
        concatPaths(this.getCurrentRoute().details.points, next.route.details.points,'after')
        validateRoute(this.getCurrentRoute(),true)
        this.emit('route-updated', this.getCurrentRoute())

        this.logEvent({message: 'switching to next video', route: this.getCurrentRoute().details.title,
                       segment:this.currentVideo.route.description.title, offset: this.offset, segmentDistance: this.currentVideo.route.description.distance,
                       totalDistance: this.getCurrentRoute().details.distance})

    }

    protected checkInfotextDisplayProps(time:number) {
        if (!this.currentVideo?.info)
            return

        const info = this.currentVideo.info.find(i => i.start <= time && i.stop > time)
        if (info) {
            this.infotext = info.props         
        }
        else {
            this.infotext = undefined
        }
    }

    protected getUIText(input:string): string {
        // replace \n with <br> in text
        let text = input                     
        if (text?.length) {
            text = text.replace(/\\n/g, '<br>')
        }

        return text

    }

    protected getLocalizedText(info: RouteInfoText): string {
        
        let text
        if (info.localizedText) {
            text = this.getLocalization().getLocalized(info.localizedText)
        }
        else {
            text = info.text
        }

        return this.getUIText(text)
    }



    getStartOverlayProps() {
        const videoState = this.getVideoState()
        const videoStateError = this.currentVideo?.error
        const videoProgress = this.getVideoLoadProgress()

        return {
            videoState,
            videoStateError,
            videoProgress
        }
        
    }


    getLogProps(): object {
        const bikeProps = this.getBikeLogProps()
        const {realityFactor,startPos,endPos,segment,showPrev} = this.startSettings 

        return {
            mode: 'video',
            route: this.getOriginalRoute().description.title,
            showPrev,
            realityFactor: `${realityFactor}%`,
            start: startPos,
            end:endPos,
            segment,
            ...bikeProps

        }
        
    }

    isStartRideCompleted(): boolean {
        return this.currentVideo?.loaded
    }

    async stop() {
        try {
            this.currentVideo.syncHelper.stop()
            delete this.startTime
            await super.stop()

        }
        catch(err) {
            this.logError(err,'stop')
        }
    }



    protected getVideoState() {
        let state = 'Starting'
        if (!this.isInitialized) {
            return state
        }

        if ( this.currentRoute?.description?.hasGpx && !this.currentRoute?.points?.length) {
            state = 'Start:Failed'
            const errMessage = 'Invalid route (GPX missing)'
            if (!this.currentVideo.error) {
                this.logError( new Error(errMessage), 'getVideoState',{route:this.currentVideo.route})
            }
            this.currentVideo.error = errMessage
            
        }
        if ( this.isStartRideCompleted()) {
            state = 'Started'
        }
        else if (this.currentVideo?.error) {
            state = 'Start:Failed'
        }
        else if (this.currentVideo?.buffering!==undefined) {
            const val = this.currentVideo?.buffering
            state = `Buffering (${val})`
        }
        return state
    }

    protected getVideoLoadProgress() {
        return {loaded:this.currentVideo?.loaded, bufferTime:this.currentVideo.bufferTime}
    }

    protected onConvertUpdate(progress:number, frames:number, time:number) {
        if (!this.currentVideo || this.currentVideo.loaded)
            return;

        if (progress===100) {
            this.logEvent({message: 'video conversion finished'})
            this.onVideoLoaded(0)
        }
        else {
            if (time!==undefined) {
                this.currentVideo.buffering = `${time}s`
                this.currentVideo.bufferTime = time
            }
            else if (progress!==undefined)
                this.currentVideo.buffering = `${progress}%`
            this.emit('state-update')
        }
    }


    protected onVideoLoaded(bufferedTime: number, video:VideoState = this.currentVideo) {
        this.logEvent({message: 'video loaded',bufferedTime})
        video.syncHelper.setBufferedTime(bufferedTime)
        video.loaded = true
        if (video.isInitial)
            this.emit('state-update')
    }

    protected onVideoLoadError(error:MediaError, video:VideoState = this.currentVideo )  {
        video.loaded = false
        video.error = this.buildVideoError(error)

        if (!video.isInitial) {
            this.logEvent({message: 'could not load next video',error:this.buildVideoError(error)})
            this.videos = [this.currentVideo]
        }
        this.emit('state-update')
    }

    protected onVideoStalled(time:number, bufferedTime:number, buffers:Array<{start:number,end:number}>,video:VideoState = this.currentVideo ) {
        this.logEvent({message: 'video stalled',bufferedTime,buffers})
        video.syncHelper.onVideoStalled(time, bufferedTime)
    }   
    protected onVideoWaiting(time:number, bufferedTime:number, buffers:Array<{start:number,end:number}>, video:VideoState = this.currentVideo ) {
        this.logEvent({message: 'video waiting',time, bufferedTime,buffers})
        video.syncHelper.onVideoWaiting(time, bufferedTime)
    }   

    protected onVideoPlaybackError(error:MediaError, video:VideoState = this.currentVideo ) {
        // TODO
    }

    protected onVideoPlayBackUpdate(time:number, rate:number,e, video:VideoState = this.currentVideo) {
        video.syncHelper.onVideoPlaybackUpdate(time,rate,e)
        this.checkInfotextDisplayProps(time)
    }

    protected onVideoEnded(video:VideoState = this.currentVideo) { 
        video.syncHelper.onVideoEnded()

        if (this.currentVideo.next) {
            this.onNextVideo()
        }
    }


    onActivityUpdate(activityPos:ActivityUpdate,data):void {  
        super.onActivityUpdate(activityPos,data)
        const offset = this.offset??0       
        const {routeDistance,speed} = activityPos

        this.currentVideo.syncHelper.onActivityUpdate(routeDistance-offset,speed)
    }


    protected initVideoSource(video:VideoState) {
        const route = video.route
        const videoFormat = route?.details?.video?.format
        const src = this.getVideoUrl(video)


        if (!src) {
            video.error = 'No video source found'
            return;
        }
        if (videoFormat==='mp4') {
            this.initMp4VideoSource(video)
            return
        }
        return this.initAviVideoSource(video)
    }

    protected initMp4VideoSource(video:VideoState):void {
        const src = this.getVideoUrl(video)
        if (src) {
            video.source = this.cleanupUrl(src) 
            video.playback = 'native'
        }
    }


    protected buildVideoError(error:MediaError) {
        // TODO
        return error.message    
    }

    protected getVideoUrl(video:VideoState): string {
        return video?.route?.details?.video?.url
                ??video?.route?.description?.videoUrl
                ??video?.route?.details?.video?.file
    }

    protected getVideoTime(routeDistance:number, video:VideoState = this.currentVideo) {
        return video.syncHelper.getVideoTimeByPosition(routeDistance)
    }

    protected initAviVideoSource(video:VideoState):VideoConversion {

        const src = this.getVideoUrl(video)
        if (!src)
            return undefined

        // check for relative URLs that were not correctly converted during import
        
        if (src?.startsWith('video://.') || src?.startsWith('video:///.')) {
            video.error = 'Cannot play video due to a failure during last import. Please import again';
            return;
        }
  
        video.playback = 'converted'
        video.source = new VideoConversion(this.cleanupUrl(src), video?.route )
        video.source.getObserver().on( 'convert-progress', this.onConvertUpdate.bind(this))
    }

    protected cleanupUrl(url:string) {
        if (!url)
            return
        let fileName = url
        const lc = url.toLowerCase()

        if (fileName.startsWith('incyclist:'))
            fileName = fileName.replace('incyclist:','file:');
        
        if ( fileName.startsWith('video:') && !lc.endsWith('.avi') )
            return fileName.replace('video:','file:');
        
        if ( fileName.startsWith('file:') && !lc.endsWith('.avi') )
            return fileName.replace('file:','video:');
        
        if ( fileName.startsWith('video:') && lc.endsWith('.avi') )
            return fileName;
        
        if ( fileName.startsWith('file:') || fileName.startsWith('http:') || fileName.startsWith('https:') || fileName.startsWith('/') )
            return fileName;
          
        
        return `./${fileName}`;
       
    }

    protected isLoopEnabled(): boolean {
        return this.isLoop() && !this.startSettings?.loopOverwrite
        
    }

    protected savePosition(startPos?:number) {

        
        
        try {
            const { lapDistance,routeDistance  } = this.position

            let distance = startPos
            if (startPos=== undefined) {
                distance = this.isLoopEnabled() ? lapDistance : routeDistance-(this.offset??0)
                if (distance>this.currentVideo.route.details.distance) {
                    distance = 0
                }
            }
            const routeId = this.currentVideo.route.description.id

            this.getUserSettings().set(`routeSelection.video.prevSetting.${routeId}.startPos`,distance)

        }
        catch (err) {
            this.logEvent({ message: 'error', fn: 'savePosition()', position: this.position, error:err.message, stack:err.stack })
        }

    }




    protected async checkForAdditionalVideos( route:Route = this.currentRoute ):Promise<boolean> {
           
        
        if (!hasNextVideo(route) || this.startSettings?.nextOverwrite)
            return false

        // does the user has imported the next route?
        const nextId = getNextVideoId(route)
        const nextRouteDetails = await this.getRouteList().getRouteDetails(nextId,true)

        if (!nextRouteDetails) 
            return false

        // already added? 
        if (this.videos.some(v => v.route?.details?.id === nextRouteDetails.id)) { 
            // if this points back to the first video, we close the loop
            if ( this.videos[0].route.details?.id === nextId) { 
                const current = this.videos.find(v => v.route?.details?.id === route.details.id)
                current.next = this.videos[0]
                return false
            }
        }

        const current = this.videos.find(v => v.route?.details?.id === route.details.id)
        const nextRoute  = this.getRouteList().getRoute(nextId)
        if (!nextRoute) {
            return false
        }

        this.addVideo( nextRoute, false,current)
        return true

    }

    @Injectable
    protected getRouteList(): RouteListService {
        return useRouteList()
    }

    @Injectable
    protected getLocalization(): LocalizationService {
        return useLocalization()
    }


}