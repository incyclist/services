import { IPageService } from "../../base/pages";
import { AccessTarget, ConfirmAccessResult } from "../../fileaccess/types";
import { ImportDisplayProps, IObserver, RouteImportStatus } from "../../types";
import { SummaryCardDisplayProps } from "../list/cards/types";
import { DisplayType, SearchFilter, SearchFilterOptions } from "../list/types";
import { RouteVideoStatus, VideoKeepChoice, VideoListPill } from "../video-availability/types";



export interface RoutePageDisplayProps  {
    loading: boolean            // indicates that the service is still loading the routes
    synchronizing?: boolean,    // indicates that a background synch is ongoing
    displayType?: DisplayType   // indicates the prefered display type (always 'list' for now)
    showImport?: boolean        // defines if the UI should render an Import button (always false for now)
    filters: SearchFilter;
    filterVisible: boolean;
    filterOptions?: SearchFilterOptions
    routes?: Array<RouteItemProps>
    detailRouteId?: string    
    downloadObserver?: IObserver
    showImportDialog?: boolean

}


export type RouteItemProps = SummaryCardDisplayProps & {
    // Badge on the card when the route's video needs attention. Absent = nothing to show,
    // which is always the case on platforms without the fileAccess binding.
    videoPill?: VideoListPill
}


export interface IPageCallBacks  {
    onFilterChanged( filters:SearchFilter ):void
    onImportClicked():void
    onFilterVisibleChange(visible:boolean):void
}

export interface RouteImportDisplayProps {
    id: string
    status: RouteImportStatus
    fileName?: string
    error?: string
}



export interface IRoutePageService extends IPageService, IPageCallBacks {
    getPageDisplayProps():RoutePageDisplayProps
    onImportClosed(): void   // called when user explicitly closes dialog
    getImportDisplayProps(): ImportDisplayProps
    getRouteDetailsProps(routeId: string): RouteDetailsProps
    onClearWorkoutSelection(): void   // '[x]' on the "Workout: <name>" row (Phase 2, HLD §4.2)

    // ---- route video actions (route details dialog) -------------------------
    onVideoDownloadPressed(routeId: string): void
    onVideoDownloadConfirmed(routeId: string, choice: VideoKeepChoice): void
    onVideoDownloadDismissed(routeId: string): void
    onVideoStop(routeId: string): void
    onVideoRetry(routeId: string): void
    onVideoKeepInstead(routeId: string): void
    onVideoRemovePressed(routeId: string): void
    onVideoRemoveConfirmed(routeId: string): void
    onVideoRemoveDismissed(routeId: string): void
    onConfirmAccess(routeId: string): Promise<void>

    // ---- Downloads list rows ------------------------------------------------
    onDownloadStop(routeId: string): void
    onDownloadRetry(routeId: string): void
    onDownloadDelete(routeId: string): void
    onDownloadKeepInstead(routeId: string): void
}

// ---- cross-visibility (Phase 2, session 2.2) --------------------------------

export interface AttachedWorkoutProps {
    id:    string      // Workout.id (content hash)
    title: string      // Workout.name
}

/** Additive companion to what RouteDetailsDialog already reads from RouteCard.openSettings().
 *  Deliberately NOT a migration of that dialog onto the page layer - see
 *  mobile/internal/designs/workout-combo-service-design.md §3.5. */
export interface RouteDetailsProps {
    routeId:         string
    attachedWorkout: AttachedWorkoutProps | null
    // Everything the details dialog needs to show about the route's video file: its state, which
    // buttons apply, and the confirmation dialogs. Absent when the platform has no fileAccess
    // binding, in which case the dialog renders exactly as before.
    video?:          RouteVideoDisplayProps
}

/** Resolved video state for one route - the UI renders this as-is and forwards the actions. */
export interface RouteVideoDisplayProps {
    status: RouteVideoStatus
    canStart: boolean
    actions: {
        download: boolean
        downloadEnabled: boolean
        stop: boolean
        retry: boolean
        keepInstead: boolean
        remove: boolean
        confirmAccess: boolean
    }
    confirmation?: {
        routeTitle: string
        sizeBytes?: number
        freeBytes?: number
        fileCount: number
        offline: boolean
    }
    removeConfirmation?: { sizeBytes?: number }
    // `target` is computed on demand, only while the state is 'access-lost'.
    access?: { target?: AccessTarget, lastResult?: ConfirmAccessResult }
}

export type DownloadStatus = 'downloading' | 'done' | 'failed' | 'required' | 'waiting' | 'not-enough-storage'

export interface DownloadRowDisplayProps {
    routeId: string
    title: string
    status: DownloadStatus
    pct?: number      // 0–100, present when status === 'downloading'
    source?: 'server' | 'icloud'   // absent = server
    sizeBytes?: number
    startedAt?: number
    choice?: VideoKeepChoice
    requiredBytes?: number
    freeBytes?: number
    actions?: {
        stop: boolean
        retry: boolean
        delete: boolean
        download: boolean
        keepInstead: boolean
    }
}