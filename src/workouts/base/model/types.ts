export type Limit = {
    min?: number,
    max?: number
}

export type PowerLimitType = 'watt' | 'pct of FTP'
export interface PowerLimit extends Limit {
    type?:PowerLimitType    
}

export type DataType = 'step' | 'segment' | 'workout' | 'plan'

export interface StepDefinition {
    type?: DataType
    start?:number
    end?:number
    duration?: number
    power?: PowerLimit
    cadence?: Limit
    hrm?: Limit
    text?: string
    work?: boolean
    steady?: boolean
    cooldown?: boolean
}

export interface CurrentStep extends StepDefinition{
    duration: number
    power?: PowerLimit
    cadence?: Limit
    hrm?: Limit
    text: string
    work: boolean
    
    remaining: number
    step?: StepDefinition
}

export interface SegmentDefinition extends StepDefinition {
    steps?: Array<StepDefinition>
    repeat?: number
}

export interface Category {
    name: string,
    index?: number
}

export interface WorkoutDefinition extends SegmentDefinition {
    type: DataType
    id?:string
    hash?:string
    name?: string
    description?: string
    category?:Category
}

export interface ScheduledWorkout {
    week: number,
    day: number,
    workoutId?: string
}

export interface PlanDefinition {
    id?:string
    hash?:string
    name?: string
    description?: string
    workouts: Array<ScheduledWorkout>
}