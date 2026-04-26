
export interface FolderInfo {
    uri: string
    displayName: string
}

export interface DiscoveredRoute {
    id: string
    folderUri: string
    folderName: string
    controlFileUri: string
    format: string
    hasVideo: boolean
    hasThumbnail: boolean
    alreadyImported: boolean
    importable: boolean
    skipReason?: string
}

export interface RouteRecord {
    id: string
    name: string
    format: string
    thumbnailPath?: string
    videoUri?: string
    sourceTreeUri: string
}

export interface FailedRoute {
    name: string
    reason: string
}

export interface ImportDisplayProps {
    phase: 'landing' | 'scanning' | 'selecting' | 'ingesting' | 'complete' | 'result' | 'error'
    discoveredRoutes: DiscoveredRoute[]
    scanProgress?: { scannedFolders: number }
    ingestProgress?: { current: number; total: number; currentName: string }
    completionSummary?: {
        imported: number
        skipped: number
        errors: number
        failedRoutes: FailedRoute[]
    }
    resultSuccess?: { routeName: string }
    error?: string
}

export interface ImportedLibrary {
    id: string
    treeUri: string
    displayName: string
    lastScanned: string
    routeCount: number
}