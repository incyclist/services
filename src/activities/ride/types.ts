import { Dimension, Unit } from "../../i18n"
import { ActivityDetails, ActivityDetailsUI } from "../base"

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