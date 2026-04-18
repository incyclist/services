import { HealthStatus } from "../../devices"
import { Dimension, Unit } from "../../i18n"
import { RoutePoint } from "../../types"
import { ActivityDetailsUI } from "../base"

export type ActivityState = 'ininitalized' | 'active' | 'paused' | 'completed' | 'idle'

export type ActivitySummaryDisplayProperties = {
    activity?: ActivityDetailsUI
    showSave?: boolean
    showContinue?: boolean
    showMap?: boolean
    preview?: string
    units?: Record<Dimension,Unit>
}

export type ActivityUpdate = {
    time: number, 
    speed: number, 
    routeDistance: number, 
    distance: number
}


export interface ActivityDashboardDataItem {
    value: string | number | undefined
    unit?: string
    label?: string
    info?: string
}

export interface ActivityDashboardItem {
    title: string
    data: ActivityDashboardDataItem[]
    size?: number
    dataState?: HealthStatus
}

export interface CurrentActivityData { 
    position?:RoutePoint, 
    distance?:number, 
    routeDistance?:number, 
    time?:number, 
    speed?:number, 
    power?:number, 
    slope?:number, 
    heartrate?:number, 
    cadence?:number, 
    timeRemaining?:number, 
    distanceRemaining?:number,
    lap?:number, 
    gear?:string }

export type ActivityDashboardDisplayProperties = ActivityDashboardItem[]