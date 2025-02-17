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

