import { ActivityDetails } from "../base"

export type ActivityState = 'ininitalized' | 'active' | 'paused' | 'completed' | 'idle'

export type ActivitySummaryDisplayProperties = {
    activity?: ActivityDetails
    showSave?: boolean
    showContinue?: boolean
    showMap?: boolean
    preview?: string
}