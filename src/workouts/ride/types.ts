import { Workout } from "../base/model"

export interface WorkoutRequest {
    time: number
    minPower?: number
    maxPower?: number
    minCadence?: number
    maxCadence?: number
    minHrm?: number
    maxHrm?: number
}

export interface ActiveWorkoutLimit extends WorkoutRequest{
    duration: number
    remaining: number
}

export interface WorkoutDisplayProperties {
    workout?:Workout, 
    title?:string, 
    ftp?:number, 
    current?:ActiveWorkoutLimit,
    start?:number,
    stop?:number

}