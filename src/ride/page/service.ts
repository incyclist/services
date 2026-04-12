import { EventLogger } from "gd-eventlog";
import { Injectable, Singleton } from "../../base/decorators";
import { IncyclistPageService } from "../../base/pages";
import { CurrentRideDisplayProps, CurrentRideState, GpxDisplayProps, IObserver, RideType, RLVDisplayProps } from "../../types";
import { AnyRidePageDisplayProps, GPXRidePageDisplayProps, IRidePageService, RideMenuProps, StartGateProps, VideoRidePageDisplayProps } from "./types";
import { useRideDisplay } from "../display";
import { sleep } from "../../utils/sleep";
import { ISecretBinding } from "../../api/secret";
import { getBindings } from "../../api";
import { useOnlineStatusMonitoring } from "../../monitoring";

const BACKGROUND_PAUSE_TIMEOUT_MS = 60000   

@Singleton
export class RidePageService extends IncyclistPageService implements IRidePageService {

    protected eventHandler: Record<string,Function> = {}
    protected backgroundTimer: NodeJS.Timeout | undefined
    protected backgroundPausedByService: boolean = false
    protected menuProps: RideMenuProps | null = null
    protected isInitialized: boolean = false
    protected startGateProps: StartGateProps|null =  null
    

    constructor()  {
        super('RidePage')

        this.eventHandler['state-update'] = this.onDisplayStateUpdate.bind(this)
        this.eventHandler['route-update'] = this.onRouteUpdate.bind(this)

    }


    async initPage():Promise<RideType> {
        try {
            const service = this.getRideDisplay()

            await service.init()     
            this.isInitialized = true  
            
            return service.getRideType()
        }
        catch(err) {
            this.logError(err,'initPage')
        }
    }

    openPage(simulate?:boolean): IObserver {
        try {
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
        catch(err) {
            this.logError(err,'openPage')
        }
    }
    closePage(): void {
        try {
            EventLogger.setGlobalConfig('page',null)
            this.logEvent({message:'page closed', page:'Rides'})        

            this.getRideDisplay().stop()
            this.menuProps = null
            this.isInitialized = false
            super.closePage()
        }
        catch(err) {
            this.logError(err,'closePage')
        }
    }

    pausePage(): Promise<void> {
        try {
            this.backgroundTimer = setTimeout(()=> {
                this.getRideDisplay().pause('user')
                this.backgroundPausedByService = true
            },BACKGROUND_PAUSE_TIMEOUT_MS)

            this.isInitialized = false
            return super.pausePage()
        }
        catch(err)  {
            this.logError(err,'pausePage')
        }
    }

    resumePage(): Promise<void>  {
        try {
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
        } catch(err) {
            this.logError(err,'resumePage')
        }
    }    

    getRideObserver(): IObserver|null {
        return this.rideObserver
    }
    getPageDisplayProps(): AnyRidePageDisplayProps {
        try {
            const rideType = this.getRideDisplay().getRideType()

            switch (rideType) {
                case 'Video':     return this.getVideoRideDisplayProps()
                case 'GPX':       return this.getGPXRideDisplayProps()
                // case 'Free-Ride': return this.getFreeRideDisplayProps()
                // case 'Workout':   return this.getWorkoutRideDisplayProps()
                default:
                    return null
            }

        }
        catch(err) {
            return null
        }

    }

    onRefreshSecrets(): void {
        // Mobile will call initSecrets and then call this method when done.
        // Dismiss the gate and proceed.
        this.hideStartgate()
    }

    onContinueAnyway(): void {
        this.hideStartgate()
    }


    onMenuOpen() {
        try  {
            const state = this.getRideDisplay().getState()
            this.menuProps = { showResume: state==='Paused' }
            this.updatePageDisplay()
        }
        catch(err) {
            this.logError(err,'onMenuOpen')
        }
    }

    onMenuClose() {
        try {
            this.menuProps = null
            this.updatePageDisplay()
        }
        catch(err) {
            this.logError(err,'onMenuOpen')
        }
    }

    onPause() {
        try {
            this.getRideDisplay().pause('user')
            this.menuProps = { showResume: true}  // menu stays open, now shows Resume
            this.updatePageDisplay()
        }
        catch(err) {
            this.logError(err,'onPause')
        }
    }

    onResume() {
        try {
            this.getRideDisplay().resume()
            this.menuProps = null
            this.updatePageDisplay()
        }
        catch(err) {
            this.logError(err,'onResume')
        }
    }

    onEndRide() {
        try {
            this.getRideDisplay().stop()
            this.moveToPreviousPage()
            this.closePage()
        } catch(err) {
            this.logError(err,'onEndRide')
        }
    }

    onRetryStart() {
        try {
            this.getRideDisplay().retryStart()
        } catch(err) {
            this.logError(err,'onRetryStart')
        }
    }

    onIgnoreStart() {
        try {
            this.getRideDisplay().startWithMissingSensors();
        }
        catch(err)  {
            this.logError(err,'onIgnoreStart')
        }
    }

    async onCancelStart() {
        try {
            this.rideObserver?.stop()
            await this.getRideDisplay().cancelStart();

            this.moveToPreviousPage()
            this.closePage()
        }
        catch(err) {
            this.logError(err,'onCancelStart')
        }
    }


    protected getVideoRideDisplayProps():VideoRidePageDisplayProps {
        const props: RLVDisplayProps = this.rideDisplayProps as CurrentRideDisplayProps & RLVDisplayProps
        const state = this.getRideDisplay().getState()
        const rideType = this.getRideDisplay().getRideType()
        const isStarting = state==='Idle' || state==='Starting' || state==='Error' 


        const displayProps:VideoRidePageDisplayProps = {
            rideState: state,
            rideType,
            startGateProps:this.startGateProps,
            startOverlayProps : isStarting ? this.getRideDisplay().getStartOverlayProps() : null,
            menuProps: this.menuProps,
            video:props.video,
            videos:props.videos,
            route: props.route


        }
        return displayProps

        
    }

    protected getGPXRideDisplayProps() {
        const props: GpxDisplayProps = this.rideDisplayProps as CurrentRideDisplayProps & GpxDisplayProps
        const state = this.getRideDisplay().getState()
        const rideType = this.getRideDisplay().getRideType()
        const isStarting = state==='Idle' || state==='Starting' || state==='Error' 
    
        const displayProps: GPXRidePageDisplayProps = {
            rideState: state,
            rideType,
            startGateProps:this.startGateProps,
            startOverlayProps : isStarting ? this.getRideDisplay().getStartOverlayProps() : null,
            menuProps: this.menuProps,
            gpx: props

        }
        return displayProps
    }


    protected async checkSecretValidity() {
        if (this.getBindings().appInfo.getChannel()==='mobile') {
            const secretsStatus = this.getSecretBinding().getSecretsStatus?.() 

            if (secretsStatus === 'stale' || secretsStatus === 'missing' || secretsStatus===undefined) {

                if (!this.getOnlineStatusMonitoring().onlineStatus)
                    this.showStartGate()
            }            
        }
    }


    protected showStartGate(): void {
        this.startGateProps = {
            title: 'Session refresh needed',
            body: 'Please connect to the internet before starting your ride',
        }
        this.updatePageDisplay()
    }

    protected hideStartgate()  {
        this.startGateProps = null;
        this.updatePageDisplay()
    }

    

    getRideType():RideType {
        return this.getRideDisplay().getRideType()

    }


    // protected getFreeRideDisplayProps() {
    //     // TODO
    // }
    // protected getWorkoutRideDisplayProps() {
    //     // TODO)
    // }


    protected updatePageDisplay() {
        this.getPageObserver()?.emit('page-update')
    }    
    protected registerEventHandlers() {
        const events = Object.keys(this.eventHandler )
        events.forEach( event=> { this.rideObserver?.on(event,this.eventHandler[event])})        
    }
    protected unregisterEventHandlers() {
        const events = Object.keys(this.eventHandler )
        events.forEach( event=> { this.rideObserver?.off(event,this.eventHandler[event])})        
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
        try {
            return this.getRideDisplay()?.getObserver()
        }catch(err) {
            this.logError(err,'get rideObserver')
        }
    }

    protected get rideDisplayProps() {
        return this.getRideDisplay().getDisplayProperties()
    }

    @Injectable
    protected getRideDisplay() {
        return useRideDisplay()
    }

    protected getSecretBinding(): ISecretBinding {
        return this.getBindings().secret
    }

    @Injectable
    protected getindings() {
        return getBindings()
    }

    @Injectable
    protected getOnlineStatusMonitoring() {
        return useOnlineStatusMonitoring()
    }
    

}


export const getRidePageService = ()=> new RidePageService()