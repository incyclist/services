import { ConnectedAppService } from "./base"

export type AppsOperation = 'ActivityUpload' | 'WorkoutUpload' | 'WorkoutDownload' | 'RouteDownload' | 'ActivityDownload'

export type AppsIntergationSpec = Map<AppsOperation,Array<string>>

export type AppDefinition = {
    name: string
    key:string
    iconUrl?: string
    connection?: ConnectedAppService<any>
}

export interface IConnectedApp {
    isConnected():boolean
    init():boolean
    getSupportedOperations():AppsOperation []
    getDefaultOperations():AppsOperation []

}

export type * from './strava/types'
export type * from './komoot/types'
export type * from './intervals/types'
