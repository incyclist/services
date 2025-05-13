import { DeviceData, UpdateRequest } from "incyclist-devices"
import { ExtendedIncyclistCapability, HealthStatus } from "../../devices"
import { ActivityUpdate } from "../../activities/ride/types"
import { Observer } from "../../base/types"
import { RoutePoint } from "../../routes/base/types"
import { Route } from "../../routes/base/model/route"
import EventEmitter from "events"
import { ActiveRideListAvatar, ActivityDetails, PrevRidesListDisplayProps, ScreenShotInfo } from "../../activities"
import { Workout } from "../../workouts"
import { Avatar } from "../../avatars"

export type RideType = 'Free-Ride' | 'GPX' | 'Video' | 'Workout'


export type CurrentRideState = 'Idle' | 'Starting' | 'Started' | 'Active' | 'Paused'| 'Error'  | 'Finished'
export type CurrentRideDeviceState = 'Starting' | 'Started' | 'Error'
export type CurrentRideViewState = 'Idle'| 'Starting' | 'Started' | 'Error'


export type CurrentRideDeviceInfo = {
    udid: string,
    name: string,
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

export type RouteMarker = {
    lat?:number, 
    lng?:number,
    routeDistance: number,
    avatar:ActiveRideListAvatar
}

export interface NearbyDisplayProps extends OverlayDisplayProps {
    observer: Observer

}

export interface RouteDisplayProps extends IRideModeServiceDisplayProps {
    position: RoutePoint
    markers?: RouteMarker[],
    sideViews: SideViewsShown
    route: Route
    startPos: number,
    endPos: number,
    realityFactor: number
    nearbyRides: NearbyDisplayProps
    map?: OverlayDisplayProps    
    upcomingElevation?: OverlayDisplayProps
    totalElevation?: OverlayDisplayProps
}


export interface GpxDisplayProps extends RouteDisplayProps {
    rideView: 'sv' | 'map' | 'sat',
}

export interface VideoDisplayProps extends RouteDisplayProps {
}

export interface StartOverlayProps {
    mode: RideType,
    rideState: CurrentRideState,
    devices: Array<CurrentRideDeviceInfo>,
    readyToStart: boolean
}

export interface OverlayDisplayProps {
    show: boolean,
    minimized?: boolean
}

export interface PrevRidesDisplayProps extends OverlayDisplayProps{
    list: Array<PrevRidesListDisplayProps>
}

export interface CurrentRideDisplayProps extends IRideModeServiceDisplayProps {
    workout?: Workout,
    route?: Route,
    activity?: ActivityDetails,
    state: CurrentRideState,
    startOverlayProps?:StartOverlayProps,
    prevRides?: PrevRidesDisplayProps
    hideAll?: boolean
}

type SideView = 'slope' | 'previous' | 'elevation' | 'sv-right' | 'sv-left' | 'prev-rides' | 'map'

export type  SideViewsShown = Record<SideView,boolean>


export interface IRideModeService<T extends IRideModeServiceDisplayProps = IRideModeServiceDisplayProps> extends EventEmitter{
    init(service: ICurrentRideService)
    start(retry?:boolean): void
    isStartRideCompleted(): boolean
    getDeviceStartSettings()
    getStartOverlayProps()

    pause(): void
    resume(): void
    stop(): Promise<void>
    onRideSettingsChanged(settings:object): void
    getDisplayProperties(props:CurrentRideDisplayProps):T

    onActivityUpdate(activityPos:ActivityUpdate, data):void
    onDeviceData(data:DeviceData,udid:string) 
    onStarted(): void
    onStopped(): void

    getScreenshotInfo(fileName:string, time:number):ScreenShotInfo
    sendUpdate(request?:UpdateRequest)
    getLogProps():object

    getCurrentRoute():Route
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

