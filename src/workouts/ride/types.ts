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