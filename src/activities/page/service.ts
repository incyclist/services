import { EventLogger } from "gd-eventlog";
import { Injectable, Singleton } from "../../base/decorators";
import { IncyclistPageService } from "../../base/pages";
import { ActivitiesPageDisplayProps, ActivityDetailsProps, AttachedWorkoutProps, IActivitiesPageService, RideAgainCheckDisplayProps } from "./types";
import { IObserver } from "../../types";
import { ActivityListDisplayProperties, useActivityList } from "../list";
import { sleep } from "../../utils/sleep";
import { useWorkoutList } from "../../workouts";
import { useDevicePairing } from "../../devices";
import { RouteInfo } from "../../routes/base/types";
import { FolderAccessService, useFolderAccess } from "../../fileaccess/service";
import { RouteVideoAvailabilityService, useRouteVideoAvailability } from "../../routes/video-availability/service";
import { RouteVideoPageActions, useRouteVideoPageActions } from "../../routes/video-availability/pageActions";
import type { RouteVideoStatus, VideoKeepChoice } from "../../routes/video-availability/types";

@Singleton
export class ActivitiesPageService extends IncyclistPageService implements IActivitiesPageService { 
    protected updateStateHandler    =  this.onStateUpdate.bind(this)

    protected listState: ActivityListDisplayProperties|undefined
    protected detailActivityId: string|undefined
    protected isOpen: boolean = false

    // Ride Again pre-check (video availability): the route currently held for the "Before you
    // ride" step, its display props, and the bound handler used to re-render it live while it is
    // open. null/undefined means nothing is blocking - always true without the fileAccess binding.
    protected rideAgainRoute: RouteInfo|undefined
    protected rideAgainCheck: RideAgainCheckDisplayProps|null = null
    protected rideAgainVideoUpdateHandler = this.onRideAgainVideoUpdate.bind(this)

    constructor() {
        super('ActivitiesPage')
    }

    openPage(): IObserver { 

        if (this.isOpen) {
            this.getActivityList().closeList()
            this.stopEventListener()
            this.closeRideAgainCheck()

        }


        try {
            this.logEvent({message:'page shown', page:'Activities'})
            EventLogger.setGlobalConfig('page','Activities')

            super.openPage()

            const service = this.getActivityList()
            this.listState = service.openList()
            this.startEventListener()
            this.isOpen = true

            // give the client time to consume the observer, then emit initial state
            sleep(5).then( ()=>{
                this.updatePageDisplay()
            })
          

            return this.getPageObserver()
        }   
        catch(err) {
            this.logError(err,'openPage')

        }
    }

    closePage(): void {
        try {
            EventLogger.setGlobalConfig('page',null)
            this.logEvent({message:'page closed', page:'Activities'})        

            this.getActivityList().closeList()
            this.stopEventListener()
            this.closeRideAgainCheck()

            this.isOpen = false
            super.closePage()
        }
        catch(err) {
            this.logError(err,'closePage')
        }
    }
    pausePage(): Promise<void> {
        try {
            this.stopEventListener()
            return super.pausePage()
        }
        catch(err) {
            this.logError(err,'pausePage')
        }
    }

    resumePage(): Promise<void>  {
        try {
            this.startEventListener()

            // C9 reconciliation + settle - the app may have been away for a while, so anything
            // iOS silently evicted needs to be caught up before the next status is trusted.
            this.getAvailability().onForeground().catch(err => this.logError(err as Error, 'resumePage'))

            return super.resumePage()
        }
        catch(err) {
            this.logError(err,'resumePage')
        }
    }

    getPageDisplayProps():ActivitiesPageDisplayProps {

        const props:ActivitiesPageDisplayProps =  {
            loading: this.listState.loading,
            activities: this.listState.activities,
            detailActivityId: this.detailActivityId,
            rideAgainCheck: this.rideAgainCheck
        }

        return props
    }

    onOpenActivity(id:string|null):void {
        try {
            this.getActivityList().select(id)
            this.detailActivityId = id===null ? undefined : id;
            this.updatePageDisplay()
        }
        catch(err) {
            this.logError(err,'onOpenActivity')
        }
    }

    onCloseActivity():void { 
        try {
            this.detailActivityId = null
            this.updatePageDisplay()
        }
        catch(err) {
            this.logError(err,'onCloseActivity')
        }

    }


    /**
     * The workout currently paired with `activityId`, for the "Workout: <name>" row on the
     * activity details dialog (HLD §4.2). `ActivityListService.openSelected()` /
     * `getSelectedActivityDisplayProps()` are not touched - see
     * mobile/internal/designs/workout-combo-service-design.md §3.6. Takes `activityId` (rather than
     * reading `ActivityListService.getSelected()`) so it stays a pure read for the activity the
     * dialog is actually showing - symmetric with `RoutesPageService.getRouteDetailsProps(routeId)`.
     */
    getActivityDetailsProps(activityId: string): ActivityDetailsProps {
        try {
            const workout = this.getWorkoutList().getSelected()
            const attachedWorkout: AttachedWorkoutProps | null = workout ? { id: workout.id, title: workout.name } : null

            return { activityId, attachedWorkout }
        }
        catch (err) {
            this.logError(err, 'getActivityDetailsProps')
            return { activityId, attachedWorkout: null }
        }
    }

    /**
     * Decides where "Ride Again" should send the user once `ActivityListService.rideAgain()`
     * has confirmed the activity's route can be started again, and navigates there - unless the
     * route's video needs a download or an access confirmation first, in which case navigation
     * is held back and the "Before you ride" step (`rideAgainCheck`) is shown instead.
     *
     * Mirrors `RoutesPageService.start()`: if devices are already paired and ready
     * (`DevicePairingService.isReadyToStart()`), the Devices/pairing screen is skipped and the
     * user goes straight to the ride; otherwise they are sent to pairing first. Ride Again
     * always resolves to a route (never a bare workout), so the ready-to-start destination is
     * the same one Routes/Workouts already use.
     *
     * Returns `'started'` once navigation actually happened, `'blocked'` while the pre-check
     * panel is open instead - existing callers that ignore the resolved value keep working.
     *
     * Without a route id, or without the `fileAccess` binding, the check is skipped entirely and
     * navigation happens synchronously within this call, with no `await` in between: this is the
     * same timing existing callers already rely on, and it is what keeps this path inert on every
     * platform without the binding.
     */
    async onRideAgain(route?: RouteInfo): Promise<'started' | 'blocked'> {
        try {
            if (!route?.id || !this.getVideoActions().isSupported()) {
                this.navigateToRide(route)
                return 'started'
            }

            let status: RouteVideoStatus
            try {
                await this.getFolderAccess().activateAll()
                status = await this.getAvailability().refresh(route.id)
            }
            catch (err) {
                // a binding failure must never block a ride start - fail open
                this.logError(err as Error, 'onRideAgain')
                this.navigateToRide(route)
                return 'started'
            }

            if (status.state === 'ready' || status.state === 'unknown') {
                this.closeRideAgainCheck()
                this.navigateToRide(route)
                return 'started'
            }

            this.openRideAgainCheck(route)
            return 'blocked'
        }
        catch(err) {
            this.logError(err,'onRideAgain')
            return 'started'
        }
    }

    /** "Not now" on the "Before you ride" step: the check is abandoned, no navigation happens. */
    onRideAgainCheckClosed(): void {
        try {
            this.closeRideAgainCheck()
            this.updatePageDisplay()
        }
        catch (err) {
            this.logError(err, 'onRideAgainCheckClosed')
        }
    }

    /**
     * "Start" on the "Before you ride" step - re-runs the same pre-check the initial tap did (the
     * video may have finished downloading, or access may have just been confirmed, while the step
     * was open) and navigates once it actually is ready, or refreshes the panel otherwise.
     */
    onRideAgainCheckStart(): Promise<'started' | 'blocked'> {
        const route = this.rideAgainRoute
        if (!route)
            return Promise.resolve('blocked')

        return this.onRideAgain(route)
    }

    // --- video actions (Ride Again pre-check), delegated to the shared page actions ------------

    onVideoDownloadPressed(routeId: string): void {
        try {
            this.getVideoActions().onVideoDownloadPressed(routeId)
        }
        catch (err) {
            this.logError(err, 'onVideoDownloadPressed')
        }
    }

    onVideoDownloadConfirmed(routeId: string, choice: VideoKeepChoice): void {
        try {
            this.getVideoActions().onVideoDownloadConfirmed(routeId, choice)
        }
        catch (err) {
            this.logError(err, 'onVideoDownloadConfirmed')
        }
    }

    onVideoDownloadDismissed(routeId: string): void {
        try {
            this.getVideoActions().onVideoDownloadDismissed(routeId)
        }
        catch (err) {
            this.logError(err, 'onVideoDownloadDismissed')
        }
    }

    onVideoStop(routeId: string): void {
        try {
            this.getVideoActions().onVideoStop(routeId)
        }
        catch (err) {
            this.logError(err, 'onVideoStop')
        }
    }

    onVideoRetry(routeId: string): void {
        try {
            this.getVideoActions().onVideoRetry(routeId)
        }
        catch (err) {
            this.logError(err, 'onVideoRetry')
        }
    }

    onVideoKeepInstead(routeId: string): void {
        try {
            this.getVideoActions().onVideoKeepInstead(routeId)
        }
        catch (err) {
            this.logError(err, 'onVideoKeepInstead')
        }
    }

    onVideoRemovePressed(routeId: string): void {
        try {
            this.getVideoActions().onVideoRemovePressed(routeId)
        }
        catch (err) {
            this.logError(err, 'onVideoRemovePressed')
        }
    }

    onVideoRemoveConfirmed(routeId: string): void {
        try {
            this.getVideoActions().onVideoRemoveConfirmed(routeId)
        }
        catch (err) {
            this.logError(err, 'onVideoRemoveConfirmed')
        }
    }

    onVideoRemoveDismissed(routeId: string): void {
        try {
            this.getVideoActions().onVideoRemoveDismissed(routeId)
        }
        catch (err) {
            this.logError(err, 'onVideoRemoveDismissed')
        }
    }

    async onConfirmAccess(routeId: string): Promise<void> {
        try {
            await this.getVideoActions().onConfirmAccess(routeId)
        }
        catch (err) {
            this.logError(err, 'onConfirmAccess')
        }
    }

    /** '[x]' on the "Workout: <name>" row (HLD §4.2). */
    onClearWorkoutSelection(): void {
        try {
            this.getWorkoutList().unselect()
            this.updatePageDisplay()
        }
        catch (err) {
            this.logError(err, 'onClearWorkoutSelection')
        }
    }

    /**
     * Deletes an activity from the list, for the swipe-to-delete action on the Activities list.
     * `ActivityListService.delete()` emits its own 'updated' event on success, which
     * `startEventListener()` already forwards into a page update - no extra refresh needed here.
     */
    async onDeleteActivity(id: string): Promise<boolean> {
        try {
            return await this.getActivityList().delete(id)
        }
        catch (err) {
            this.logError(err, 'onDeleteActivity')
            return false
        }
    }

    protected updatePageDisplay() {
        this.getPageObserver()?.emit('page-update')
    }

    protected navigateToRide(route?: RouteInfo): void {
        const pairing = this.getDevicePairing()
        const readyToStart = pairing.isReadyToStart()

        this.logEvent({message:'Attempting to start a ride again', id: route?.id, title: route?.title, readyToStart})

        const next = readyToStart ? '/rideDeviceOK' : '/pairingStart'
        this.moveTo(next)
    }

    /** Opens (or refreshes) the "Before you ride" step and starts watching for a live update. */
    protected openRideAgainCheck(route: RouteInfo): void {
        this.rideAgainRoute = route
        this.rideAgainCheck = {
            routeId: route.id,
            routeTitle: route.title ?? '',
            video: this.getVideoActions().getDisplayProps(route.id),
            downloadedWhileOpen: false
        }
        this.subscribeToRideAgainVideoUpdates()
        this.updatePageDisplay()
    }

    protected closeRideAgainCheck(): void {
        if (!this.rideAgainCheck && !this.rideAgainRoute)
            return

        this.unsubscribeFromRideAgainVideoUpdates()
        this.rideAgainRoute = undefined
        this.rideAgainCheck = null
    }

    protected subscribeToRideAgainVideoUpdates(): void {
        try {
            // idempotent: a re-check while the panel is already open must not double-subscribe
            this.unsubscribeFromRideAgainVideoUpdates()
            this.getAvailability().on('route-video-update', this.rideAgainVideoUpdateHandler)
            this.getVideoActions().on('route-video-actions-update', this.rideAgainVideoUpdateHandler)
        }
        catch (err) {
            this.logError(err as Error, 'subscribeToRideAgainVideoUpdates')
        }
    }

    protected unsubscribeFromRideAgainVideoUpdates(): void {
        try {
            this.getAvailability().off('route-video-update', this.rideAgainVideoUpdateHandler)
            this.getVideoActions().off('route-video-actions-update', this.rideAgainVideoUpdateHandler)
        }
        catch (err) {
            this.logError(err as Error, 'unsubscribeFromRideAgainVideoUpdates')
        }
    }

    /**
     * A route's video (or its pending confirmation/access UI state) changed while the "Before you
     * ride" step was open. `routeId` is absent for some upstream events (e.g. an access grant
     * change) - those are treated as "could affect the open route" rather than ignored.
     */
    protected onRideAgainVideoUpdate(routeId?: string): void {
        try {
            const route = this.rideAgainRoute
            if (!route || !this.rideAgainCheck)
                return
            if (routeId && routeId !== route.id)
                return

            const status = this.getAvailability().getStatus(route.id)
            const nowReady = status.state === 'ready' || status.state === 'unknown'

            this.rideAgainCheck = {
                ...this.rideAgainCheck,
                video: this.getVideoActions().getDisplayProps(route.id),
                downloadedWhileOpen: this.rideAgainCheck.downloadedWhileOpen || nowReady
            }
            this.updatePageDisplay()
        }
        catch (err) {
            this.logError(err as Error, 'onRideAgainVideoUpdate')
        }
    }


    protected onStateUpdate(state?: ActivityListDisplayProperties) {
        if (state)
            this.listState = state
        this.updatePageDisplay()
    }


    protected startEventListener() {
        const observer  = this.getActivityList().getObserver()
        if (!observer)
            return

        observer.on('updated', this.updateStateHandler)
        observer.on('loaded', this.updateStateHandler)

       
    }

    protected stopEventListener(final?:boolean) {
        const observer  = this.getActivityList().getObserver()
        if (!observer)
            return

        observer.off('updated', this.updateStateHandler)
        observer.off('loaded', this.updateStateHandler)

    }



    @Injectable
    getActivityList()  {
        return useActivityList()
    }

    @Injectable
    protected getWorkoutList() {
        return useWorkoutList()
    }

    @Injectable
    protected getDevicePairing() {
        return useDevicePairing()
    }

    @Injectable
    protected getFolderAccess(): FolderAccessService {
        return useFolderAccess()
    }

    @Injectable
    protected getAvailability(): RouteVideoAvailabilityService {
        return useRouteVideoAvailability()
    }

    @Injectable
    protected getVideoActions(): RouteVideoPageActions {
        return useRouteVideoPageActions()
    }

}

export const getActivitiesPageService = () => new ActivitiesPageService()