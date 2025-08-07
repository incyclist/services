import { Observer } from "../../../base/types"

export type WorkoutSyncInfo = {
    service: string, 
    syncProvider: IWorkoutSyncProvider 
}

export interface IWorkoutSyncProvider {
    isConnected(): boolean
    sync(): Observer
    
}