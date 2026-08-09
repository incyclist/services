import { HealthStatus } from "../../devices"
import { Dimension, Unit } from "../../i18n"
import { RoutePoint } from "../../types"
import { ActivityDetailsUI } from "../base"
import type { WorkoutGraphActuals, WorkoutGraphPlan } from "../../ride/page"

export type ActivityState = 'ininitalized' | 'active' | 'paused' | 'completed' | 'idle'

export type ActivityWorkoutSummaryGraph = {
    plan: WorkoutGraphPlan
    actuals: WorkoutGraphActuals
}

export type ActivitySummaryDisplayProperties = {
    activity?: ActivityDetailsUI
    showSave?: boolean
    showContinue?: boolean
    showMap?: boolean
    // true for a route-less workout (routeType==='None') - there's no GPS/route data to show on
    // a map in this case, so the summary should render the workout profile instead (see
    // workoutGraph). Mutually exclusive with showMap.
    showWorkoutSummary?: boolean
    workoutGraph?: ActivityWorkoutSummaryGraph
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