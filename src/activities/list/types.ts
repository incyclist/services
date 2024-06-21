import { Avatar } from "../../avatars";

export type PastActivityLogEntry = {
    routeHash?: string,
    routeId?:string,
    tsStart: number,
    title: string,
    time?: number,
    power?: number,
    heartrate?: number,    
    speed?:number,
    distance?: number,
    routeDistance?: number,
    lap?: number,
    timeGap: string,
    distanceGap: string,
    lat?:number,
    lng?:number
}

export type PastActivityInfo = Array<PastActivityLogEntry|null>

export interface PrevRidesListDisplayProps extends PastActivityLogEntry {
    position?: number;
    avatar?: Avatar
}