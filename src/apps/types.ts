export type AppsOperation = 'ActivityUpload' | 'WorkoutUpload' | 'WorkoutDownload' | 'RouteDownload'

export type AppsIntergationSpec = Record<AppsOperation,Array<string>>

export type AppDefinition = {
    name: string
    key:string
}

