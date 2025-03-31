import { DeviceData, UpdateRequest } from "incyclist-devices"
import { ExtendedIncyclistCapability, HealthStatus } from "../../devices"
import { ActivityUpdate } from "../../activities/ride/types"
import { Observer } from "../../base/types"

export type RideType = 'Free-Ride' | 'GPX' | 'Video' | 'Workout'


export type CurrentRideState = 'Idle' | 'Starting' | 'Started' | 'Active' | 'Paused'| 'Error'  | 'Finished'
export type CurrentRideDeviceState = 'Starting' | 'Started' | 'Error'
export type CurrentRideViewState = 'Idle'| 'Starting' | 'Started' | 'Error'


export type CurrentRideDeviceInfo = {
    udid: string,
    name: string,
    isMandatory: boolean,
    isControl: boolean,
    status: CurrentRideDeviceState
    stateText?:string
    capabilities:Array<ExtendedIncyclistCapability>
    healthStatus?: HealthStatus
}

export interface IRideModeService {
    init(service: ICurrentRideService)
    start(retry?:boolean): void
    isStartRideCompleted(): boolean
    getDeviceStartSettings()

    pause(): void
    resume(): void
    stop(): Promise<void>
    getDisplayProperties()

    onActivityUpdate(activityPos:ActivityUpdate, data):UpdateRequest|undefined
    onDeviceData(data:DeviceData,udid:number) 

    sendUpdate(request:UpdateRequest)
    getLogProps():object
}
export interface ICurrentRideService {
    start(): void;
    startWithMissingSensors(): void;
    retryStart(): void;
    pause(requester: 'user' | 'device'): void;
    resume(): void;
    stop(exit: boolean): Promise<void>;
    toggleCyclingMode(): void;
    takeScreenshot(): Promise<void>;
    stopWorkout(): void;
    adjustPower(increase: boolean, large: boolean): void;
    getDisplayProperties();
    getObserver(): Observer;
    getRideType(): RideType;
    getState(): CurrentRideState;

}

