import { ReadDirResult } from "../../api"
import { FormattedNumber } from "../../i18n"
import { Route } from "../base/model/route"

// The result of the user selecting a root folder
export interface FolderInfo {
    uri: string          // content:// tree URI (Android) or scoped URL (iOS)
    displayName: string  // shown in UI: "/Videos" or "NAS › Videos"
}


// Output of the scan phase — filesystem only, no parsing
export interface ScannedRoute {
    controlFileUri: string   // URI of the primary/control file
    folderUri: string        // URI of the containing folder
    folderName: string       // display name of the folder
    format: RouteFormat      // 'xml' | 'epm' | 'rlv' | 'gpx'
    scanError?: string       // set if companion file missing
    files: ReadDirResult[]
}

export type RouteFormat = string

// Output of the parse phase
// Contains only fields not already present on Route.description
export interface ParsedRoute {
    route: Route             // the full parsed Route object
    controlFileUri: string   // carried from ScannedRoute
    folderUri: string        // carried from ScannedRoute
    alreadyImported: boolean // set via RouteListService.existsBySourceUri()
    parseError?: string      // set if AVI, no video, parse failure
    format: RouteFormat      // 'xml' | 'epm' | 'rlv' | 'gpx'
}

// A display-ready row in the route selection list.
// The service produces this — the view renders it directly.
export interface RouteDisplayItem {
    id: string                      // stable identifier for selection tracking
    label: string                   // filename during scan, route title after parse
    distance?: FormattedNumber      // undefined until parsed
    format: RouteFormat
    alreadyImported: boolean
    importable: boolean             // false if scanError or parseError is set
    errorReason?: string            // human-readable, shown inline when importable=false
}


// Drives the ImportRoutesDialog view
// Uses RouteDisplayItem instead of raw ParsedRoute —
// the service handles all formatting before handing to the UI
export interface ImportDisplayProps {
    phase: 'landing' | 'scanning' | 'parsing' | 'selecting' | 'ingesting' | 'complete' | 'result' | 'error'
    routes: RouteDisplayItem[]
    scanProgress?: { scannedFolders: number }
    parseProgress?: { parsed: number; total: number }
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

export interface FailedRoute {
    name: string
    reason: string
}

export interface ImportedLibrary {
    id: string           // uuid — used as JsonRepository key
    treeUri: string      // SAF tree URI for permission management
    displayName: string  // shown in future "Manage Libraries" UI
    lastScanned: string  // ISO date
    routeCount: number
}