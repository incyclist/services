import { Unit } from "../../i18n"

export type Gender = 'M' | 'F' | 'X'
export type ActiveRideRouteType = 'follow route' |  'video' | 'free ride'

export type ActiveRideUser = {
    id: string,
    name?: string,
    weight?: number,
    gender?: Gender
    ftp?:number
}

export type ActiveRideRoute = {
    title: string,
    activityId?: string,
    type: ActiveRideRouteType
    startPos: number,
    realityFactor: number
    isLap: boolean,
    routeHash: string
    distance: number
}

export type ActiveRideBike = {
    name: string,
    interface: string
}

export interface ActiveRidePosition {
    lat?: number,
    lng?:number,
    elevation?: number,
    slope?: number
}

export type ActiveRideEntry = {
    id: string,
    user: ActiveRideUser
    ride: ActiveRideRoute
    bike?: ActiveRideBike
    sessionId?: string,
    tsLastUpdate?: number,
    currentDuration?: number,
    currentRideDistance?: number,
    currentPower?: number
    currentSpeed?: number,
    currentPosition?: ActiveRidePosition
    currentLap?: number,
    isPaused?: boolean,
    isCoach?: boolean,
}

export type ActiveRideListMessageHandler = (topic:string, message:ActiveRideListMessage) => void

export interface ActiveRideListMessage {}

export interface ActivityStartMessage extends ActiveRideListMessage {
    user: ActiveRideUser;
    ride: ActiveRideRoute;
    position?: ActiveRidePosition;
    sessionId?: string,
}

export interface ActivityUpdateMessage extends ActiveRideListMessage {
    position:ActiveRidePosition,
    rideDistance: number,
    speed?:number, 
    power?:number, 
    cadence?:number, 
    heartrate?:number, 
    lap?:number, 
    duration?: number
    isPaused?:boolean
}

export interface ActivityInfoMessage extends ActivityStartMessage { 
    rideDistance: number,
    lap?:number, 
    duration?: number
}

export type ActiveRideListAvatar = {
    shirt: string,
    helmet: string,
    gender?: string
}

export type ActiveRideListDisplayItem = {
    isUser?: boolean
    avatar?:ActiveRideListAvatar
    isPaused?: boolean   
    name: string,
    distance?: number|{value:number, unit:Unit}
    lapDistance?:number,
    diffDistance?: number|{value:number, unit:Unit},
    diffTime?: number,
    lap?: number,
    power?: number,
    mpower?: number,
    speed?: number|{value:number, unit:Unit},
    lat?:number,
    lng?:number,
    backgroundColor?: string,
    textColor?: string
} 