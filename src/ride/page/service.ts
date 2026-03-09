import { EventLogger } from "gd-eventlog";
import { Singleton } from "../../base/decorators";
import { IncyclistPageService } from "../../base/pages";
import { CurrentRideDisplayProps, CurrentRideState, IObserver, RideType, RLVDisplayProps } from "../../types";
import { AnyRidePageDisplayProps, IRidePageService, RideMenuProps, VideoRidePageDisplayProps } from "./types";
import { useRideDisplay } from "../display";
import { sleep } from "../../utils/sleep";

const BACKGROUND_PAUSE_TIMEOUT_MS = 60000   

@Singleton
export class RidePageService extends IncyclistPageService implements IRidePageService {

    protected eventHandler: Record<string,Function> = {}
    protected backgroundTimer: NodeJS.Timeout | undefined
    protected backgroundPausedByService: boolean = false
    protected menuProps: RideMenuProps | null = null
    protected isInitialized: boolean = false
    

    constructor()  {
        super('RidePage')

        this.eventHandler['state-update'] = this.onDisplayStateUpdate.bind(this)
        this.eventHandler['route-update'] = this.onRouteUpdate.bind(this)

    }


    async initPage():Promise<RideType> {
        const service = this.getRideDisplay()

        await service.init()     
        this.isInitialized = true  
        return service.getRideType()
    }

    openPage(simulate?:boolean): IObserver {
        this.logEvent({message:'page shown', page:'Rides'})
        
        EventLogger.setGlobalConfig('page','Rides')

        super.openPage()

        try {
            const service = this.getRideDisplay()

            if (!this.isInitialized) {
                service.init()
            }
            this.registerEventHandlers()
            service.start(simulate)

            sleep(5).then( ()=>{
                this.updatePageDisplay()
            })
        }
        catch(err) {
            this.logError(err,'openPage')
        }
        return this.getPageObserver()

    }
    closePage(): void {
        EventLogger.setGlobalConfig('page',null)
        this.logEvent({message:'page closed', page:'Rides'})        

        this.getRideDisplay().stop()
        this.menuProps = null
        this.isInitialized = false
        super.closePage()
    }

    pausePage(): Promise<void> {
        this.backgroundTimer = setTimeout(()=> {
            this.getRideDisplay().pause('user')
            this.backgroundPausedByService = true
        },BACKGROUND_PAUSE_TIMEOUT_MS)

        this.isInitialized = false
        return super.pausePage()
    }

    resumePage(): Promise<void>  {
        if (this.backgroundTimer) {
            clearTimeout(this.backgroundTimer)
        }

        // TODO:
        //   if backgroundPausedByService:
        //     backgroundPausedByService = false
        //     // ride is paused, menu is open -- user must consciously tap Resume
        //     // no automatic resume
        //   else:
        //     // short interruption -- ride never paused, nothing to do        

        return super.resumePage()
    }    

    getRideObserver(): IObserver|null {
        return this.rideObserver
    }
    getPageDisplayProps(): AnyRidePageDisplayProps {
        const rideType = this.getRideDisplay().getRideType()

        switch (rideType) {
            case 'Video':     return this.getVideoRideDisplayProps()
            // case 'GPX':       return this.getGPXRideDisplayProps()
            // case 'Free-Ride': return this.getFreeRideDisplayProps()
            // case 'Workout':   return this.getWorkoutRideDisplayProps()
            default:
                return null
        }



    }

    onMenuOpen() {
        const state = this.getRideDisplay().getState()
        this.menuProps = { showResume: state==='Paused' }
        this.updatePageDisplay()

    }

    onMenuClose() {
        this.menuProps = null
        this.updatePageDisplay()
    }

    onPause() {
        this.getRideDisplay().pause('user')
        this.menuProps = { showResume: false }  // menu stays open, now shows Resume
        this.updatePageDisplay()
    }

    onResume() {
        this.getRideDisplay().resume()
        this.menuProps = null
        this.updatePageDisplay()
    }

    onEndRide() {
        this.getRideDisplay().stop()
        this.moveToPreviousPage()
        this.closePage()
    }

    onRetryStart() {
        this.getRideDisplay().retryStart()
    }

    onIgnoreStart() {
        this.getRideDisplay().startWithMissingSensors();
    }

    async onCancelStart() {
        this.rideObserver?.stop()
        await this.getRideDisplay().cancelStart();

        this.moveToPreviousPage()
        this.closePage()

    }


    protected getVideoRideDisplayProps():VideoRidePageDisplayProps {
        const props: RLVDisplayProps = this.rideDisplayProps as CurrentRideDisplayProps & RLVDisplayProps
        const state = this.getRideDisplay().getState()
        const rideType = this.getRideDisplay().getRideType()
        const isStarting = state==='Idle' || state==='Starting' || state==='Error' 

        // export interface RidePageDisplayProps {
        //     rideState:         CurrentRideState
        //     rideType:          RideType
        //     startOverlayProps: StartOverlayProps | GPXStartOverlayProps | VideoStartOverlayProps | null
        //     menuProps:         RideMenuProps | null
        // }

        // // Video ride -- extends base with video-specific props
        // export interface VideoRidePageDisplayProps extends RidePageDisplayProps {
        //     video?:   VideoDisplayProps        // single video
        //     videos?:  VideoDisplayProps[]      // next-video chain (all loaded, hidden except active)
        // }


        const displayProps:VideoRidePageDisplayProps = {
            rideState: state,
            rideType,
            startOverlayProps : isStarting ? this.getRideDisplay().getStartOverlayProps() : null,
            menuProps: this.menuProps,
            video:props.video,
            videos:props.videos,
            route: props.route


        }
        return displayProps

        
    }

    getRideType():RideType {
        return this.getRideDisplay().getRideType()

    }


    // protected getGPXRideDisplayProps() {
    //     // TODO
    // }
    // protected getFreeRideDisplayProps() {
    //     // TODO
    // }
    // protected getWorkoutRideDisplayProps() {
    //     // TODO)
    // }


    protected updatePageDisplay() {
        this.getPageObserver().emit('page-update')
    }    
    protected registerEventHandlers() {
        const events = Object.keys(this.eventHandler )
        events.forEach( event=> { this.rideObserver.on(event,this.eventHandler[event])})        
    }
    protected unregisterEventHandlers() {
        const events = Object.keys(this.eventHandler )
        events.forEach( event=> { this.rideObserver.off(event,this.eventHandler[event])})        
    }

    protected onDisplayStateUpdate( state:CurrentRideState, props:{pauseReason?:'user'|'device'} ) {
        switch(state) {
            case 'Paused': 
                this.menuProps = { showResume:true}
                break;
            case 'Active': 
                this.menuProps = null
                break;

        }
        this.updatePageDisplay()
    }

    protected onRouteUpdate() {
        this.updatePageDisplay()
    }

    protected moveToPreviousPage() {
        this.moveTo('$contentPage')        
    }

    protected get rideObserver () {
        return this.getRideDisplay().getObserver()
    }

    protected get rideDisplayProps() {
        return this.getRideDisplay().getDisplayProperties()
    }


    protected getRideDisplay() {
        return useRideDisplay()
    }
    

}


export const getRidePageService = ()=> new RidePageService()