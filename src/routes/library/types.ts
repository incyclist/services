import { ReadDirResult } from "../../api"
import { FormattedNumber } from "../../i18n"
import { IObserver } from "../../types"
import { Route } from "../base/model/route"
import type { ParserFactory } from "../base/parsers/factory"

// The result of the user selecting a root folder
export interface FolderInfo {
    uri: string          // content:// tree URI (Android) or scoped URL (iOS)
    displayName: string  // shown in UI: "/Videos" or "NAS › Videos"
    grant?: string       // opaque token keeping access alive across restarts (iOS); never logged
    grantError?: string  // set instead of `grant` when the platform could not produce one
}

/**
 * Stable, translatable reason why a route could not be imported. The accompanying free-text
 * reason is kept for logs; the UI maps this key to its own copy instead of matching on text.
 */
export type RouteImportErrorCode =
    | 'AVI_NOT_SUPPORTED'
    | 'NO_VIDEO'
    | 'READ_FAILED'
    | 'PARSE_FAILED'
    | 'ICLOUD_OFFLINE'
    | 'ICLOUD_DOWNLOAD_FAILED'
    | 'MISSING_COMPANION'
    | 'UNSUPPORTED'

/**
 * A failed single-route import as plain data: the stable code, the free-text reason, and -
 * for `MISSING_COMPANION` - the extension of the file the route needs.
 */
export interface RouteImportFailure {
    code: RouteImportErrorCode
    reason: string
    missingExt?: string
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
    folderName?: string       // carried from ScannedRoute - display name of the containing folder
    alreadyImported: boolean // set via RouteListService.existsBySourceUri()
    parseError?: string      // set if AVI, no video, parse failure
    parseErrorCode?: RouteImportErrorCode  // stable key for the same failure
    duplicateOf?: string     // set if the route repeats one already in this import (parseError says so too)
    format: RouteFormat      // 'xml' | 'epm' | 'rlv' | 'gpx'
    observer?:IObserver
}

export type ParseState = 'waiting'|'parsing'|'parsed'

// A display-ready row in the route selection list.
// The service produces this — the view renders it directly.
export interface RouteDisplayItem {
    id: string                      // stable identifier for selection tracking
    // URI of the control file the row was scanned from. Set from the scan on, so it stays the same
    // while the row changes from placeholder to parsed route - UIs can key rows on it. Optional,
    // as not every consumer needs it.
    fileUri?: string
    label: string                   // filename during scan, route title after parse
    folder?: string                  // display name of the containing folder - disambiguates
                                     // same-titled routes in the selection list
    distance?: FormattedNumber      // undefined until parsed
    format: RouteFormat
    alreadyImported: boolean
    parseState: ParseState
    importable: boolean             // false if scanError or parseError is set
    errorReason?: string            // human-readable, shown inline when importable=false
    errorCode?: RouteImportErrorCode // stable key for errorReason, so the UI needn't match text
    // set for a route that repeats one already in this import - not a problem with the file, so
    // UIs show it as a duplicate instead of an error. Optional: consumers that don't know it still
    // see errorReason.
    duplicateOf?: string
    observer:IObserver
}


// Drives the ImportRoutesDialog view
// Uses RouteDisplayItem instead of raw ParsedRoute —
// the service handles all formatting before handing to the UI
export interface ImportDisplayProps {
    phase: 'landing' | 'scanning' | 'parsing' | 'selecting' | 'ingesting' | 'complete' | 'result' | 'error'
    routes: RouteDisplayItem[]
    // `failedFolders` counts folders that could not be listed (permission error, a NAS gone
    // offline mid-scan, …) so the UI can report an incomplete scan instead of a silently short
    // result.
    scanProgress?: { scannedFolders: number; failedFolders?: number }
    parseProgress?: { parsed: number; total: number; waitingForICloud?: boolean }
    ingestProgress?: { current: number; total: number; currentName: string }
    completionSummary?: {
        imported: number
        skipped: number
        errors: number
        failedRoutes: FailedRoute[]
    }
    resultSuccess?: { routeName: string }
    error?: string
    // The same single-route failure as `error`, with its stable code - so the UI can show the
    // same sentence it shows for the same failure anywhere else.
    failure?: RouteImportFailure
    // True when at least one route in this import failed because its files could not be
    // downloaded from the cloud - drives the "import the folder again" hint. Always populated.
    hasICloudDownloadFailures: boolean
}

export interface FailedRoute {
    name: string
    reason: string
    code?: RouteImportErrorCode
    missingExt?: string
}

/**
 * One entry of a folder listing as the library scanner handles it.
 *
 * Identical to `ReadDirResult` when the platform reports directory-ness (mobile). An entry of a
 * names-only listing (desktop) is flagged `unknownType` until the scanner has resolved whether it
 * is a directory. A directory whose contents are already known carries them in `listing`, so it
 * is never read twice.
 */
export interface ScanEntry {
    name: string
    uri: string
    isDirectory?: boolean
    unknownType?: boolean
    listing?: ScanEntry[]
}

/** State shared by every folder visited during one scan. */
export interface ScanContext {
    observer: IObserver
    parsers: ParserFactory
    progress: { scannedFolders: number, failedFolders: number }
    discoveredCount: { value: number }
    // routes found by this scan only - a scan that outlives its dialog session must not
    // add to the results of the next one
    results: ScannedRoute[]
    recursive: boolean
}

export interface ImportedLibrary {
    id: string           // uuid — used as JsonRepository key
    treeUri: string      // SAF tree URI for permission management
    displayName: string  // shown in future "Manage Libraries" UI
    lastScanned: string  // ISO date
    routeCount: number
}