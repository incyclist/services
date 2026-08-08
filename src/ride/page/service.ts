import { Injectable, Singleton } from "../../base/decorators";
import { CurrentRideDisplayProps, GpxDisplayProps, RideType, RLVDisplayProps } from "../../types";
import { AnyRidePageDisplayProps, GPXRidePageDisplayProps, IRidePageService, RidePageDisplayProps, VideoRidePageDisplayProps } from "./types";
import { RidePageServiceBase } from "./base";
import { useRideDisplay } from "../display";
import { sleep } from "../../utils/sleep";
import { ISecretBinding } from "../../api/secret";
import { getBindings } from "../../api";
import { useOnlineStatusMonitoring } from "../../monitoring";

@Singleton
export class RidePageService extends RidePageServiceBase implements IRidePageService {

    constructor()  {
        super('RidePage')

        this.eventHandler['route-update'] = this.onRouteUpdate.bind(this)
    }

    protected getPageLogName(): string {
        return 'Rides'
    }

    protected requiresOwnInit(): boolean {
        return true
    }

    protected getBackgroundPauseRequester(): 'user' | 'device' {
        return 'user'
    }

    protected onRideStartRequested(): void {
        sleep(5).then( ()=>{
            this.updatePageDisplay()
        })
    }

    getPageDisplayProps(): AnyRidePageDisplayProps {

        const startOverlayProps = this.getRideDisplay().getStartOverlayProps()

        const noRideProps:RidePageDisplayProps = {
            rideState:'Error',
            startOverlayProps,
            rideType: null as unknown as RideType,
            menuProps: null,
            startGateProps: null

        }

        try {
            const rideType = this.getRideDisplay().getRideType()

            switch (rideType) {
                case 'Video':     return this.getVideoRideDisplayProps()
                case 'GPX':       return this.getGPXRideDisplayProps()
                // case 'Free-Ride': return this.getFreeRideDisplayProps()
                // 'Workout' is intentionally not handled here - it is owned entirely by
                // WorkoutRidePageService (workouts/ride/page), a sibling page service, not a branch of this one.
                default:
                    return noRideProps
            }

        }
        catch {
            return noRideProps
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
        catch(err:any) {
            this.logError(err,'onMenuOpen')
        }
    }

    onMenuClose() {
        try {

            const state = this.getRideDisplay().getState()
            if (state==='Finished' || this.menuProps?.finished) {
                // this.onEndRide()
                this.moveToPreviousPage()
                this.closePage()
                return;
            }

            this.menuProps = null
            this.updatePageDisplay()
        }
        catch(err:any) {
            this.logError(err,'onMenuClose')
        }
    }

    onFinished() {
        try {
            this.menuProps = {showResume:false,finished:true}
            this.updatePageDisplay()
        }
        catch(err:any) {
            this.logError(err,'onResume')
        }

    }

    onEndRide() {
        try {
            this.getRideDisplay().stop()
            this.moveToPreviousPage()
            this.closePage()
        } catch(err:any) {
            this.logError(err,'onEndRide')
        }
    }

    protected getVideoRideDisplayProps():VideoRidePageDisplayProps {
        const props: RLVDisplayProps = this.rideDisplayProps as CurrentRideDisplayProps & RLVDisplayProps

        const displayProps:VideoRidePageDisplayProps = {
            ...this.buildBaseDisplayProps(),
            video:props.video,
            videos:props.videos,
            route: props.route
        }
        return displayProps


    }

    protected getGPXRideDisplayProps():GPXRidePageDisplayProps {
        const props: GpxDisplayProps = this.rideDisplayProps as CurrentRideDisplayProps & GpxDisplayProps

        const displayProps: GPXRidePageDisplayProps = {
            ...this.buildBaseDisplayProps(),
            rideView: props.rideView,
            route: props.route,
            displayObserver: props.displayObserver
        }
        return displayProps
    }


    protected async checkSecretValidity() {
        if (this.getBindings().appInfo?.getChannel()==='mobile') {
            const secretsStatus = this.getSecretBinding()?.getSecretsStatus?.()

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


    // protected getFreeRideDisplayProps() {
    //     // TODO
    // }

    protected onRouteUpdate() {
        this.updatePageDisplay()
    }

    protected get rideDisplayProps() {
        return this.getRideDisplay().getDisplayProperties()
    }

    protected getSecretBinding(): ISecretBinding|undefined {
        return this.getBindings().secret
    }

    // Kept per-subclass rather than shared on RidePageServiceBase - see the import-cycle note on
    // RidePageServiceBase.getRideDisplay().
    @Injectable
    protected getRideDisplay() {
        return useRideDisplay()
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
