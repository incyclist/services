import { DeviceData, UpdateRequest } from "incyclist-devices";
import { Observer } from "../../base/types";
import { ActiveWorkoutLimit, useWorkoutRide } from "../../workouts";
import { ICurrentRideService, IRideModeService } from "./types";
import { IncyclistService } from "../../base/service";
import { useDeviceRide } from "../../devices";
import { Injectable } from "../../base/decorators";
import { ActivityUpdate } from "../../activities/ride/types";
import { sleep } from "incyclist-devices/lib/utils/utils";
import { ScreenShotInfo } from "../../activities";

export class RideModeService extends IncyclistService implements IRideModeService {


    protected observer:Observer
    protected prevData: DeviceData
    protected prevLimits: ActiveWorkoutLimit
    protected processing: Array<UpdateRequest> = []
    protected queued: Array<UpdateRequest> = []
    protected service: ICurrentRideService

    
    constructor() {
        super('Ride')
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
    }

    getDisplayProperties() {
        return {}
    }

    onActivityUpdate(activityPos:ActivityUpdate,data):UpdateRequest {

        const limits = this.getWorkoutLimits()

        const request = this.buildRequest(limits)
        this.sendUpdate(request)

        this.prevLimits = limits
        return request
    }

    onDeviceData(data:DeviceData,udid:string) {
        this.logEvent({ message: "Bike Update:", data, udid });



        this.prevData = data
    }

    getLogProps(): object {
        return {}
    }

    getScreenshotInfo(fileName: string, time: number):ScreenShotInfo {
        return {fileName, time}        
    }


    protected getWorkoutLimits() {
        return this.getWorkoutRide().getCurrentLimits()
    }

    protected buildRequest(limits: ActiveWorkoutLimit):UpdateRequest {
        return {}
    }

    async sendUpdate(request:UpdateRequest) {  
        if (request.targetPowerDelta) {
            this.processPowerDeltaRequest(request)

        }
        else {
            this.getDeviceRide().sendUpdate(request)
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

    @Injectable
    protected getDeviceRide() { 
        return useDeviceRide()
    }

    protected getWorkoutRide() { 
        return useWorkoutRide()
    }

}


