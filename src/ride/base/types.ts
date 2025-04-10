import { DeviceData, UpdateRequest } from "incyclist-devices"
import { ExtendedIncyclistCapability, HealthStatus } from "../../devices"
import { ActivityUpdate } from "../../activities/ride/types"
import { Observer } from "../../base/types"
import { RoutePoint } from "../../routes/base/types"
import { Route } from "../../routes/base/model/route"
import EventEmitter from "events"
import { ActivityDetails, PrevRidesListDisplayProps, ScreenShotInfo } from "../../activities"
import { RouteSettings } from "../../routes/list/cards/RouteCard"
import { Workout } from "../../workouts"

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

export interface IRideModeServiceDisplayProps {}

export interface WorkoutDisplayProps extends IRideModeServiceDisplayProps {}

export interface CurrentPosition extends RoutePoint {
    lap?: number, 
    lapDistance?:number,
    heading?: number
}

export interface RouteDisplayProps extends IRideModeServiceDisplayProps {
    position: RoutePoint
    sideViews: SideViewsShown
    route: Route
    startPos: number,
    endPos: number,
    realityFactor: number
}


export interface GpxDisplayProps extends RouteDisplayProps {
    mode: 'sv' | 'map' | 'sat',
}

export interface VideoDisplayProps extends RouteDisplayProps {
}

export interface StartOverlayProps {
    mode: RideType,
    rideState: CurrentRideState,
    devices: Array<CurrentRideDeviceInfo>,
    readyToStart: boolean
}

export interface CurrentRideDisplayProps extends IRideModeServiceDisplayProps {
    workout?: Workout,
    route?: Route,
    activity?: ActivityDetails,
    state: CurrentRideState,
    startOverlayProps?:StartOverlayProps,
    showPrevRides: boolean
    prevRidesList?: Array<PrevRidesListDisplayProps>
}

type SideView = 'slope' | 'previous' | 'elevation' | 'sv-right' | 'sv-left' | 'prev-rides' | 'map'

export type  SideViewsShown = Record<SideView,boolean>


export interface IRideModeService<T extends IRideModeServiceDisplayProps = IRideModeServiceDisplayProps> extends EventEmitter{
    init(service: ICurrentRideService)
    start(retry?:boolean): void
    isStartRideCompleted(): boolean
    getDeviceStartSettings()

    pause(): void
    resume(): void
    stop(): Promise<void>
    getDisplayProperties():T

    onActivityUpdate(activityPos:ActivityUpdate, data):UpdateRequest|undefined
    onDeviceData(data:DeviceData,udid:string) 

    getScreenshotInfo(fileName:string, time:number):ScreenShotInfo
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
    getDisplayProperties():CurrentRideDisplayProps;
    getObserver(): Observer;
    getRideType(): RideType;
    getState(): CurrentRideState;
}

