import { ActivityUpdate } from "../../activities/ride/types";
import { Observer } from "../../base/types";
import { Route } from "../../routes/base/model/route";
import { VideoConversion, VideoSyncHelper } from "../../video";
import { CurrentRideDisplayProps, RLVDisplayProps, VideoDisplayProps } from "../base";
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
    offset?:number
    next?: VideoState
}

export class RLVDisplayService extends RouteDisplayService {

    protected currentVideo: VideoState
    protected videos: Array<VideoState>
    protected offset: number
    protected isInitialized: boolean
    
    


    constructor() {
        super()        
        this.isInitialized = false
    }

    initView(): void {
        console.log('# init view')

        this.currentVideo = undefined
        this.videos = []

        this.addVideo(this.currentRoute, true)
        this.offset = 0
        this.isInitialized = true

        console.log('# init view done', this.currentVideo, this.videos)

    }

    protected addVideo( route:Route, isCurrent?:boolean):void {
        console.log('# add video', isCurrent, route)
        try {

            const observer = new Observer()
            const video:VideoState = {isCurrent,isInitial:isCurrent,route, loaded:false,observer}

            this.initVideoSource(video)    

            
            const loopMode = isCurrent && this.isLoopEnabled()       
            const startPos = isCurrent ? this.startSettings?.startPos??0 : 0

            video.syncHelper = new VideoSyncHelper(route, startPos,{loopMode,observer} )
            this.videos.push(video)

            if (isCurrent) {
                this.currentVideo = video
            }        
            console.log('# add video done', isCurrent, route)            
        }
        catch (error) {
            console.log('# addVideo error', error)
        }
    }



    pause() {
        super.pause()

        this.currentVideo.syncHelper.pause()
    }


    getDisplayProperties(props: CurrentRideDisplayProps):RLVDisplayProps {

        const startTime = this.getVideoTime(this.startSettings?.startPos??0)
        const routeProps = super.getDisplayProperties(props)

        if ( this.videos.length === 1) {
            const video:VideoDisplayProps = {
                src: this.currentVideo.source,
                startTime,
                muted: true,
                loop: this.isLoopEnabled(),
                playback: this.currentVideo.playback,
                observer: this.currentVideo.observer,
                onLoaded: this.onVideoLoaded.bind(this),
                onLoadError: this.onVideoLoadError.bind(this),
                onPlaybackError: this.onVideoPlaybackError.bind(this),
                onPlaybackUpdate: this.onVideoPlayBackUpdate.bind(this),
                onStalled: this.onVideoStalled.bind(this),
                onWaiting: this.onVideoWaiting.bind(this),
            }

            return {
                ...routeProps,
                video
            }    
           
        }
        else {
            const videos: Array<VideoDisplayProps> = this.videos.map(video => {
                return {
                    src: video.source,
                    id: video.route?.details?.id,
                    startTime: video.isInitial? startTime: 0,
                    hidden: !video.isCurrent,
                    muted: true,
                    loop: false,
                    playback: video.playback,
                    observer: video.observer,
                    onLoaded: (bufferedTime: number) => { this.onVideoLoaded(bufferedTime, video) },
                    onLoadError: (error:MediaError) => { this.onVideoLoadError.bind(error,video)},
                    onPlaybackError: (error:MediaError) => { this.onVideoPlaybackError.bind(this) },
                    onPlaybackUpdate: (time:number, rate:number,e) => { this.onVideoPlayBackUpdate.bind(time, rate,e,video) }
                }
            })
            return {
                ...routeProps,
                videos
            }

        }

        
    }
    getStartOverlayProps() {
        const videoState = this.getVideoState()
        const videoStateError = this.currentVideo.error
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
            route: this.route.description.title,
            showPrev,
            realityFactor,
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
            await super.stop()

        }
        catch(err) {
            this.logError(err,'stop')
        }
    }



    protected getVideoState() {
        let state = 'Starting'
        if (!this.isInitialized)
            return state

        if ( this.isStartRideCompleted()) {
            state = 'Started'
        }
        else if (this.currentVideo.error) {
            state = 'Start:Failed'
        }
        return state
    }

    protected getVideoLoadProgress() {
        return undefined
    }



    protected onVideoLoaded(bufferedTime: number, video:VideoState = this.currentVideo) {
        console.log('# video loaded', video?.id, bufferedTime,)

        video.syncHelper.setBufferedTime(bufferedTime)
        video.loaded = true
        if (video.isInitial)
            this.emit('state-update')
    }

    protected onVideoLoadError(error:MediaError, video:VideoState = this.currentVideo )  {
        console.log('# ERROR',error)
        video.loaded = false
        video.error = this.buildVideoError(error)

        if (!video.isInitial) {
            this.logEvent({message: 'could not load next video',error:this.buildVideoError(error)})
            this.videos = [this.currentVideo]
        }
        this.emit('state-update')
    }

    protected onVideoStalled(time:number, bufferedTime:number, buffers:Array<{start:number,end:number}>,video:VideoState = this.currentVideo ) {
        console.log('# video stalled', time, bufferedTime, buffers)
        this.logEvent({message: 'video stalled',bufferedTime,buffers})
        video.syncHelper.onVideoStalled(time, bufferedTime)
    }   
    protected onVideoWaiting(time:number, bufferedTime:number, buffers:Array<{start:number,end:number}>, video:VideoState = this.currentVideo ) {
        console.log('# video waiting', time, bufferedTime, buffers)
        this.logEvent({message: 'video waiting',time, bufferedTime,buffers})
        video.syncHelper.onVideoWaiting(time, bufferedTime)
    }   

    protected onVideoPlaybackError(error:MediaError ) {
        // TODO
    }

    protected onVideoPlayBackUpdate(time:number, rate:number,e, video:VideoState = this.currentVideo) {
        video.syncHelper.onVideoPlaybackUpdate(time,rate,e)
    }

    onActivityUpdate(activityPos:ActivityUpdate,data):void {  

        const offset = this.currentVideo.offset??0
        super.onActivityUpdate(activityPos,data)
        const {routeDistance,speed} = activityPos

        this.currentVideo.syncHelper.onActivityUpdate(routeDistance-offset,speed)
    }


    protected initVideoSource(video:VideoState) {
        const route = video.route
        const videoFormat = route?.details?.video?.format
        const src = route?.details?.video?.url


        console.log('# init video source',src, videoFormat)

        if (!src) {
            video.error = 'No video source found'
            return;
        }
        if (videoFormat==='mp4') {
            this.initMp4VideoSource(video)
            return
        }
        return this.getAviVideoSource(video)
    }

    protected initMp4VideoSource(video:VideoState):void {
        video.source = this.cleanupUrl(video.route?.details?.video?.url) 
        video.playback = 'native'

        console.log('# init mp4 video source done',video.source, video.playback)
    }


    protected buildVideoError(error:MediaError) {
        // TODO
        return error.message    
    }

    protected getVideoTime(routeDistance:number, video:VideoState = this.currentVideo) {
        return video.syncHelper.getVideoTimeByPosition(routeDistance)
    }

    protected getAviVideoSource(video:VideoState):VideoConversion {

        const src = video.route?.details?.video?.url

        // check for relative URLs that were not correctly converted during import
        
        if (src?.startsWith('video://.') || src?.startsWith('video:///.')) {
            video.error = 'Cannot play video due to a failure during last import. Please import again';
            return;
        }
  
        video.playback = 'converted'
        video.source = new VideoConversion(this.cleanupUrl(src) )
    }

    protected cleanupUrl(url:string) {
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
            const { lapDistance  } = this.position
            const routeId = this.route.description.id
            this.getUserSettings().set(`routeSelection.video.prevSetting.${routeId}.startPos`,startPos??lapDistance)

        }
        catch (err) {
            this.logEvent({ message: 'error', fn: 'savePosition()', position: this.position, error:err.message, stack:err.stack })
        }

    }



}