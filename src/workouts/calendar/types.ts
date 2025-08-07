import { Workout } from "../base/model"

export interface WorkoutCalendarEntry  {
    day: Date
    workoutId?: string
    workout?: Workout   
    updated: Date
    source?:string
}

export interface ScheduledWorkout extends WorkoutCalendarEntry {
    id: string
    name: string
    type: string
    
}