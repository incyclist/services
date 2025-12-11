import { DeviceData, UpdateRequest } from "incyclist-devices";
import { Observer } from "../../base/types";
import { ActiveWorkoutLimit, useWorkoutRide } from "../../workouts";
import { CurrentRideDisplayProps, ICurrentRideService, IRideModeService, IRideModeServiceDisplayProps } from "./types";
import { IncyclistService } from "../../base/service";
import { useDeviceRide } from "../../devices";
import { Injectable } from "../../base/decorators";
import { ActivityUpdate } from "../../activities/ride/types";
import { sleep } from "incyclist-devices/lib/utils/utils";
import { ScreenShotInfo } from "../../activities";
import { Route } from "../../routes/base/model/route";

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

    init(service: ICurrentRideService) {
        this.observer = service.getObserver()
        this.service = service
    }
    start(): void {
        return
    }
    isStartRideCompleted(): boolean {
        return true
    }

    getDeviceStartSettings() {
        return {}
    }
    pause(): void {
        return
    }
    resume(): void {
        return
    }
    async stop(): Promise<void> {
        this.removeAllListeners()
        this.isStopped = true
    }

    getStartOverlayProps() {
        return {}
    }
    getDisplayProperties(props: CurrentRideDisplayProps):IRideModeServiceDisplayProps {
        return { dbColumns: this.getDashboardColumns() }
    }

    onActivityUpdate(activityPos:ActivityUpdate,data):void {

        const limits = this.getWorkoutLimits()

        const request = this.buildRequest({limits})
    
        this.sendUpdate(request)

        this.prevLimits = limits
    }

    onDeviceData(data:DeviceData,udid:string) {
        this.logEvent({ message: "Bike Update:", data, udid });



        this.prevData = data
    }

    onRideSettingsChanged(settings:object): void {

    }


    onStarted(): void { }
        
    onStopped(): void { }

    getLogProps(): object {
        return {}
    }

    getScreenshotInfo(fileName: string, time: number):ScreenShotInfo {
        return {fileName, time}        
    }

    getCurrentRoute():Route {
        return undefined
    }


    protected getWorkoutLimits() {
        return this.getWorkoutRide().getCurrentLimits()
    }

    protected buildRequest(props:{limits?: ActiveWorkoutLimit, reset?:boolean}={}):UpdateRequest {
        return {}
    }

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
            catch {}                
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

    protected getBikeLogProps(): object {

        const device = this.getDeviceRide().getControlAdapter()
        if (!device ) 
            return { };

        const mode = this.getDeviceRide().getCyclingMode();

        if (mode?.getName()==='Simulator') {
            return { bike: 'Simulator', interface: 'Simulator',mode: 'Simulator' }  
        }

        const settings = mode?.getSettings()??{}
        return {
            bike: device.adapter?.getDisplayName(),
            interface: device.adapter?.getInterface(),
            bikeMode: mode?.getName(),
            ...settings
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

}


