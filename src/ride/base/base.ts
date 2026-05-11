import { CyclingMode, DeviceData, UpdateRequest } from "incyclist-devices";
import { Observer } from "../../base/types";
import { ActiveWorkoutLimit, useWorkoutList, useWorkoutRide } from "../../workouts";
import { CurrentRideDisplayProps, ICurrentRideService, IRideModeService, IRideModeServiceDisplayProps } from "./types";
import { IncyclistService } from "../../base/service";
import { useDeviceRide } from "../../devices";
import { Injectable } from "../../base/decorators";
import { ActivityUpdate } from "../../activities/ride/types";
import { ScreenShotInfo } from "../../activities";
import { Route } from "../../routes/base/model/route";
import { sleep } from "../../utils/sleep";

/**
 * Base implementation of ride mode service for handling ride lifecycle and device/activity updates.
 *
 * This service extends IncyclistService and implements IRideModeService to provide core ride
 * management functionality. It handles device data updates, activity updates, and manages
 * power delta requests with a queue system for sequential processing. The service integrates
 * with device, workout, and activity systems through dependency injection.
 *
 * Subclasses should override methods to provide specific behavior for different ride modes
 * (workout, free ride, route, etc.).
 */
export class RideModeService extends IncyclistService implements IRideModeService {


    protected observer:Observer
    protected prevData: DeviceData
    protected prevLimits: ActiveWorkoutLimit
    protected processing: Array<UpdateRequest> = []
    protected queued: Array<UpdateRequest> = []
    protected service: ICurrentRideService
    protected isStopped: boolean

    
    constructor() {
        super('Ride')
        this.isStopped = false
    }

    /**
     * Initializes the ride mode service with a current ride service instance.
     *
     * This method must be called before other operations. It extracts and stores the observer
     * from the provided service and stores the service reference for use in ride event handling.
     *
     * @param service - The current ride service providing observer and lifecycle callbacks
     */
    init(service: ICurrentRideService) {
        this.observer = service.getObserver()
        this.service = service
    }
    /**
     * Starts the ride in the current mode.
     *
     * This base implementation is a no-op. Subclasses should override to implement
     * mode-specific start behavior.
     *
     * @param retry - Optional flag indicating whether this is a retry attempt
     */
    start(): void {
        return
    }
    /**
     * Checks if the ride start process has completed.
     *
     * @returns True if ride start is completed, false otherwise
     */
    isStartRideCompleted(): boolean {
        return true
    }

    /**
     * Returns device-specific start settings for the ride mode.
     *
     * @returns Object containing device settings, empty in base implementation
     */
    getDeviceStartSettings() {
        return {}
    }
    /**
     * Pauses the currently active ride.
     *
     * This base implementation is a no-op. Subclasses should override to implement
     * mode-specific pause behavior.
     */
    pause(): void {
        return
    }
    /**
     * Resumes a paused ride.
     *
     * This base implementation is a no-op. Subclasses should override to implement
     * mode-specific resume behavior.
     */
    resume(): void {
        return
    }
    /**
     * Stops the ride and cleans up resources.
     *
     * Removes all event listeners and sets the stopped flag. Subclasses may override
     * to add mode-specific cleanup logic.
     */
    async stop(): Promise<void> {
        this.removeAllListeners()
        this.isStopped = true
    }

    /**
     * Returns properties for the start overlay UI component.
     *
     * @returns Object containing overlay properties, empty in base implementation
     */
    getStartOverlayProps() {
        return {}
    }
    /**
     * Returns display properties for rendering the current ride view.
     *
     * Includes dashboard column configuration based on device cycling mode settings.
     *
     * @param props - Display configuration from the ride display state
     * @returns Display properties including dashboard layout settings
     */
    getDisplayProperties(props: CurrentRideDisplayProps):IRideModeServiceDisplayProps {
        return { dbColumns: this.getDashboardColumns() }
    }

    /**
     * Handles activity update events during a ride.
     *
     * Retrieves current workout limits, builds an update request with those limits,
     * and sends the request to the device. Stores the previous limits for tracking.
     *
     * @param activityPos - Current activity update with ride metrics
     * @param data - Additional activity data (unused in base implementation)
     */
    onActivityUpdate(activityPos:ActivityUpdate,data):void {

        const limits = this.getWorkoutLimits()

        const request = this.buildRequest({limits})

        this.sendUpdate(request)

        this.prevLimits = limits
    }

    /**
     * Handles device data updates from the connected bike.
     *
     * Logs the bike update event and stores the previous device data state.
     * This data is used for tracking changes and detecting new metrics.
     *
     * @param data - Device data including power, heart rate, cadence, etc.
     * @param udid - Unique device identifier
     */
    onDeviceData(data:DeviceData,udid:string) {
        this.logEvent({ message: "Bike Update:", data, udid });



        this.prevData = data
    }

    /**
     * Handles changes to ride settings during an active ride.
     *
     * This base implementation is a no-op. Subclasses should override to handle
     * mode-specific settings changes.
     *
     * @param settings - Updated ride settings object
     */
    onRideSettingsChanged(settings:object): void {

    }


    /**
     * Called when the ride has started.
     *
     * This base implementation is a no-op. Subclasses may override to perform
     * initialization when the ride begins.
     */
    onStarted(): void { }
        
    /**
     * Called when the ride has stopped.
     *
     * This base implementation is a no-op. Subclasses may override to perform
     * cleanup when the ride ends.
     */
    onStopped(): void { }

    /**
     * Returns logging properties for the current ride mode.
     *
     * @returns Object containing log properties, empty in base implementation
     */
    getLogProps(): object {
        return {}
    }

    /**
     * Creates screenshot metadata for a ride moment.
     *
     * @param fileName - Name of the screenshot file
     * @param time - Ride time in milliseconds when screenshot was taken
     * @returns Screenshot information object with filename and timestamp
     */
    getScreenshotInfo(fileName: string, time: number):ScreenShotInfo {
        return {fileName, time}
    }

    /**
     * Returns the current route being followed, if any.
     *
     * @returns The route object, or undefined if no route is active
     */
    getCurrentRoute():Route {
        return undefined
    }


    protected getWorkoutLimits() {
        return this.getWorkoutRide().getCurrentLimits()
    }

    protected buildRequest(props:{limits?: ActiveWorkoutLimit, reset?:boolean}={}):UpdateRequest {
        return {}
    }

    /**
     * Sends a device update request, handling power delta requests separately.
     *
     * Power delta requests are queued and processed sequentially to avoid overwhelming the device.
     * Regular update requests are sent immediately. If no request is provided, builds a reset request
     * and sends it if it contains any data.
     *
     * @param request - Optional update request to send to the device
     */
    async sendUpdate(request?:UpdateRequest) {
        let update = request
        if ( !request) {
            update = this.buildRequest({reset:true})
            if (!update||Object.keys(update).length===0) {
                return
            }
        }

        if (update.targetPowerDelta) {
            this.processPowerDeltaRequest(update)

        }
        else {
            if (!update||Object.keys(update).length===0) {
                return
            }

            this.getDeviceRide().sendUpdate(update)
        }
    }

    protected processPowerDeltaRequest(request:UpdateRequest) {
        const send = async ( r:UpdateRequest)=> {

            this.processing.push(r)
            try {
                await this.getDeviceRide().sendUpdate(r)
                await sleep(50)
            }
            catch { // ignore
            }                
            this.processing.shift()


            if (this.queued.length>0) {
                const request = this.queued.shift()
                send(request)
            }

        }

        // if there is currenty an update being processed, just add the new requested powerDelta to the item in the queue            
        if (this.processing.length>0) {
            if (this.queued.length>0) {
                const total = this.queued[0]
                total.targetPowerDelta += request.targetPowerDelta
                this.queued = [total]
            }
            else {
                this.queued = [request]
            }
            
            
            return
        }

        send(request)
        
    }

    protected isForcedERG() {
        let forceErgMode = false
        if (this.getWorkoutList().getSelected()) {
            forceErgMode = this.getWorkoutList().getStartSettings()?.useErgMode
        }
        return forceErgMode
    }

    protected updatePropsForForcedERG( mode:CyclingMode, logProps:any) {
        try {
            const isSIM = typeof mode?.isSIM ==='function' ? mode.isSIM() : false

            if (this.isForcedERG()) {
                if (isSIM) {
                    logProps.bikeMode = 'ERG (Workout)'
                }

                // TODO: find a better way to only show relevant settings
                delete logProps['virtshift']
                delete logProps['startGear']
                delete logProps['slopeAdj']
                delete logProps['slopeAsjDown']
            }
        }
        catch(err) {
            this.logError(err,'updatePropsForForcedERG')
        }



    }

    protected getBikeLogProps(): object {

        const device = this.getDeviceRide().getControlAdapter()
        if (!device ) 
            return { };

        const mode = this.getDeviceRide().getCyclingMode() as CyclingMode;

        if (mode?.getName()==='Simulator') {
            return { bike: 'Simulator', interface: 'Simulator',bikeMode: 'Simulator' }  
        }

        const bikeMode = mode?.getName()
        const settings = mode?.getSettings()??{}
        const logProps = { bikeMode, ...settings}
        this.updatePropsForForcedERG(mode, logProps)

        return {
            bike: device.adapter?.getDisplayName(),
            interface: device.adapter?.getInterface(),            
            ...logProps
        }
    }

    protected getDashboardColumns(): number {

        
        const mode = this.getDeviceRide().getCyclingMode()
        const virtshift = mode?.getSetting('virtshift')
        const enabled = virtshift!==undefined && virtshift!==null && virtshift!=='Disabled'

        return enabled ? 8 : 7;
    }

    @Injectable
    protected getDeviceRide() { 
        return useDeviceRide()
    }

    protected getWorkoutRide() { 
        return useWorkoutRide()
    }

    @Injectable
    protected getWorkoutList() {
        return useWorkoutList()
    }


}


