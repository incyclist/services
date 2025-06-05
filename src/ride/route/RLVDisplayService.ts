import { Observer } from "../../base/types";
import { Route } from "../../routes/base/model/route";
import { VideoConversion } from "../../video";
import { CurrentRideDisplayProps, RLVDisplayProps, VideoDisplayProps } from "../base";
import { RouteDisplayService } from "./RouteDisplayService";

export class RLVDisplayService extends RouteDisplayService {
    protected videoObserver: Observer
    protected videoSource: string|VideoConversion
    protected videoError: string
    protected videoPlayback: 'native' | 'converted'
    protected videoLoaded: boolean
    protected currentRoute: Route


    constructor() {
        super()        
    }

    initView(): void {
        this.initVideoSource()    
        this.videoLoaded = false
        this.videoObserver = new Observer()


    }


    getDisplayProperties(props: CurrentRideDisplayProps):RLVDisplayProps {

        const startTime = this.getVideoTime(this.startSettings?.startPos??0)
        const video:VideoDisplayProps = {
            src: this.videoSource,
            startTime,
            muted: true,
            playback: this.videoPlayback,
            observer: this.videoObserver,
            onLoaded: this.onVideoLoaded.bind(this),
            onLoadError: this.onVideoLoadError.bind(this),
            onPlaybackError: this.onVideoPlaybackError.bind(this),
            onPlaybackUpdate: this.onVideoPlayBackUpdate.bind(this)

        }

        const routeProps = super.getDisplayProperties(props)
        
        return {
            ...routeProps,
            video
        }    
    }
    getStartOverlayProps() {
        const videoState = this.getVideoState()
        const videoStateError = this.videoError
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
        return this.videoLoaded
    }


    protected getVideoState() {
        let state = 'Starting'
        if ( this.isStartRideCompleted()) {
            state = 'Started'
        }
        else if (this.videoError) {
            state = 'Start:Failed'
        }
        return state
    }

    protected getVideoLoadProgress() {
        return undefined
    }



    protected onVideoLoaded() {
        this.videoLoaded = true
        this.emit('state-update')
    }

    protected onVideoLoadError(error:MediaError )  {
        console.log('# ERROR',error)
        this.videoLoaded = false
        this.videoError = this.buildVideoError('error' /*error*/)

        this.emit('state-update')
    }
    protected onVideoPlaybackError(error:string ) {
        // TODO
    }

    protected onVideoPlayBackUpdate(time:number, rate:number) {
        // TODO
        
    }

    protected onPositionUpdate( state) {

        console.log('# position update',state)
        const {route,position} = state??{}    

        // TODO use SyncHelper to check for rate updates

        this.videoObserver.emit('rate-update',1)
        

        
    }


    protected initVideoSource() {
        const videoFormat = this.currentRoute?.details?.video?.format
        const src = this.currentRoute?.details?.video?.url


        console.log('# init video source',src, videoFormat)

        if (!src) {
            this.videoError = 'No video source found'
            return;
        }
        if (videoFormat==='mp4') {
            this.initMp4VideoSource()
            return
        }
        return this.getAviVideoSource()
    }

    protected initMp4VideoSource():void {
        this.videoSource = this.cleanupUrl(this.route?.details?.video?.url) 
        this.videoPlayback = 'native'

        console.log('# init mp4 video source done',this.videoSource, this.videoPlayback)
    }


    protected buildVideoError(error:string) {
        // TODO
        return error    
    }

    protected getVideoTime(routeDistance:number) {
        // TODO
        return 0
    }

    protected getAviVideoSource():VideoConversion {

        const src = this.route?.details?.video?.url

        // check for relative URLs that were not correctly converted during import
        
        if (src?.startsWith('video://.') || src?.startsWith('video:///.')) {
            this.videoError = 'Cannot play video due to a failure during last import. Please import again';
            return;
        }
  
        this.videoPlayback = 'converted'
        this.videoSource = new VideoConversion(this.cleanupUrl(src) )
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


}