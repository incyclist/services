import { ConnectedAppService } from "./base"

export type AppsOperation = 'ActivityUpload' | 'WorkoutUpload' | 'WorkoutDownload' | 'RouteDownload' | 'ActivityDownload'

export type AppsIntergationSpec = Record<AppsOperation,Array<string>>

export type AppDefinition = {
    name: string
    key:string
    iconUrl?: string
    connection?: ConnectedAppService<any>
}

export interface IConnectedApp {
    isConnected():boolean
    init():boolean
}

export type * from './strava/types'
export type * from './komoot/types'
export type * from './intervals/types'
