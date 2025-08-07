export type Limit = {
    /** @public minimum value */
    min?: number,
    /** @public maximum value */
    max?: number
}

export type PowerLimitType = 'watt' | 'pct of FTP'

export interface PowerLimit extends Limit {
    /** @public defines the type of the power limit (either percentage of FTP or absolute) */
    type?:PowerLimitType    
}

export type DataType = 'step' | 'segment' | 'workout' | 'plan' | 'scheduled'

export interface StepDefinition {
    /** @public identifies the type of the Object (should always be 'step', 'segment', 'workout', 'plan'*/
    type?: DataType
    /** @public starting time (in sec since start of workout) of the current step/segment/workout*/
    start?:number
    /** @public end time (in sec since start of workout) of the current step/segment/workout*/
    end?:number
    /** @public duration of the current step/segment/workout*/
    duration?: number
    /** @public the limits (max,min) set for power */    
    power?: PowerLimit
    /** @public the limits (max,min) set for cadence */    
    cadence?: Limit
    /** @public the limits (max,min) set for heartrate */    
    hrm?: Limit
    /** @public An optional text to be displayed for this step/segment*/    
    text?: string
    /** @public identifies if the current step represents a work(true) or rest period (false) */    
    work?: boolean
    /** @public boolean to identify if the current step represents a work or rest period */    
    steady?: boolean
    /** @public boolean to identify if the current step represents a cooldown phase  */    
    cooldown?: boolean
}

/** @public Provides information on the current limits, step defintion (optional) and remainder of a workout step for a given time during the workout*/
export interface CurrentStep extends StepDefinition{

    /** @public start time (in sec) of the current step*/
    start?: number

    /** @public duration (in sec) of the current step*/
    duration: number
    /** @public the limits (max,min) set for power */    
    power?: PowerLimit
    /** @public the limits (max,min) set for cadence */    
    cadence?: Limit
    /** @public the limits (max,min) set for heartrate */    
    hrm?: Limit
    /** @public An optional text to be displayed for this step/segment*/    
    text: string
    /** @public identifies if the current step represents a work(true) or rest period (false) */    
    work: boolean
    
    /** @public remaining time (in sec) within the current step*/
    remaining: number

    /** @public the original definition of the step*/
    step?: StepDefinition
}

/** @public
 * A Segment allows to combine multiple steps and repeat them multiple times
 */
export interface SegmentDefinition extends StepDefinition {
    /** @public the individual steps of this segment */
    steps?: Array<StepDefinition>
    /** @public number of repetitions */
    repeat?: number
}

/** @public
 * A category represents a collection of multiple workouts
 */
export interface Category {
    name: string,
    index?: number
}

/** @public
 * A Workout
 */
export interface WorkoutDefinition extends SegmentDefinition {
    type: DataType
    /** @public unique id of the workout */
    id?:string
    /** @public hash of the workout */
    hash?:string
    /** @public the name of the workout (to be shown in lists (dashboards) */
    name?: string
    /** @public A description of the workout (to be shown in info screens */
    description?: string
    /** @public A categorym the workout belongs to */
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