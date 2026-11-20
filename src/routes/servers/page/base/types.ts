import type { RouteServerStatus } from '../../types'

/**
 * Contract of the page service (RouteServersSettingsPageService)
 *
 * The observer that `open()` returns emits
 *  - `page-update`: the display props changed, read them with `getPageDisplayProps()`
 *  - `closed` with a `RouteServersClosedEvent`: the page is finished. The page service decides why (see
 *    RouteServersCloseReason), the app only follows: it does not need to look at the display props to find out
 *    whether to close the dialog or to go back.
 *
 * Actions (all synchronous, results show up as `page-update`): open, close, showAdd, showManualEntry, back,
 * addKnown, retryKnown, setManualUrl, setManualName, checkAndAdd, check, add, confirmAddEmpty, cancelAddEmpty,
 * requestRemove, setRemoveRoutes, confirmRemove, cancelRemove.
 *
 * Adding a server:
 *  - origin 'settings': the page stays where it is. A server added manually shows its success for a moment and then
 *    returns to the list (view 'list'). A known server that was added shows as 'added' in the Known section, the new
 *    row is highlighted (`highlightKey`) and the view is not changed.
 *  - origin 'import': a server that was added (manually or from the known list) shows its success for a moment, then
 *    `closed` is emitted with reason 'done', so the app returns to the Import dialog.
 */

/** where the user came from: drives what Back and Close do */
export type RouteServersOrigin = 'settings' | 'import'

/**
 * Why the page was closed:
 *  - 'done':   a server was added from the Import dialog. The app closes the page and goes on with the import
 *  - 'back':   the user went back from the first view of the page. The app returns to where the user came from
 *              (the Import landing view, or the settings list) WITHOUT closing the surrounding dialog
 *  - 'cancel': the page was closed without a result (close action, or the page was opened again). The app returns to
 *              where the user came from (the Import landing view, or the settings list) WITHOUT closing the
 *              surrounding dialog
 */
export type RouteServersCloseReason = 'done' | 'back' | 'cancel'

/** payload of the `closed` event */
export interface RouteServersClosedEvent {
    reason: RouteServersCloseReason
}

export type RouteServersView = 'list' | 'add' | 'add-manual'   // 'add-manual' = phone second step

export interface RouteServerItem {
    /** storage key = the name as the user typed it. Actions (remove, highlight) use the key */
    key: string
    /** name to show: the name as the user typed it (the same as `key`, e.g. 'Ebeling Hoppe'). Never a pascal-cased form */
    name: string
    /** 'alpine-videos.example.org'; undefined for the built-in server */
    host?: string
    isBuiltIn: boolean
    /** host is on the home network -> tag 'Local' */
    isLocal?: boolean
    /** http:// -> tag 'Local · not encrypted' */
    isUnencrypted?: boolean
    /** config-file entry that the rules of the app would refuse */
    addedOutsideApp?: boolean
    status: RouteServerStatus
    routeCount?: number
    /** ready to render: '24 routes', 'Checking…', ... */
    statusText: string
    /** ready to render: 'Local', 'Local · not encrypted' */
    tag?: string
    /** ready to render: 'Added outside the app' */
    note?: string
    canRemove: boolean
}

export interface KnownServerItem {
    id: string
    name: string
    description: string
    operator?: string
    state: 'available' | 'checking' | 'added' | 'error'
    /** number of routes of this server that are in the route list. Only set if the server was added and has routes */
    routeCount?: number
    /** ready to render: 'Checking…' (checking), 'Added ✓ · 7 routes' (added; 'Added ✓' while no routes are known). Not set if available */
    statusText?: string
    /** ready to render */
    error?: string
}

export type ManualEntryState = 'idle' | 'checking' | 'confirm-empty' | 'checked' | 'success' | 'error'

export interface ManualEntryProps {
    url: string
    name: string
    /** user typed in Name -> suggestions never overwrite it */
    nameTouched: boolean
    /** derived from the host */
    suggestedName?: string
    /** e.g. 'http://nas:8080' after the home-network http switch (or after a check) */
    resolvedUrl?: string
    /** "Local server — traffic isn't encrypted. Use this only on your home network." */
    localNote?: string
    /**
     * 'checked' = probe OK, waiting for Add (two-step entry, or after an http switch).
     * 'confirm-empty' = server works but has no routes: the app offers `confirmAddEmpty()` ("Add anyway") and
     * `cancelAddEmpty()` (back to 'idle', address and name are kept).
     */
    state: ManualEntryState
    urlError?: string
    nameError?: string
    /** e.g. 'Found 24 routes.' */
    message?: string
    /** one-step entry (checkAndAdd): address non-empty AND name valid. In state 'checked': name valid (add) */
    canSubmit: boolean
    /** two-step entry (check): address non-empty */
    canCheck: boolean
}

export interface RemoveServerDialogProps {
    key: string
    name: string
    routeCount: number
    downloadedCount?: number
    /** formatted, e.g. '1.2 GB' */
    downloadedSize?: string
    /** default false = keep */
    removeRoutes: boolean
    /** ready to render: 'Remove "Alpine Videos"?' */
    title: string
    /** ready to render: 'You have 24 routes from this server in your route list.'. Not set if the server has no routes */
    text?: string
    /** ready to render, only if the server has routes */
    keepLabel?: string
    /** ready to render, only if the server has routes. Mentions downloaded videos and their size if there are any */
    removeRoutesLabel?: string
    /** 'Remove server' if the server has routes, 'Remove' otherwise */
    confirmLabel: string
}

export interface RouteServersEmptyStateProps {
    title: string
    text: string
}

export interface RouteServersSettingsDisplayProps {
    view: RouteServersView
    origin: RouteServersOrigin
    /** built-in first, then user servers by name */
    servers: Array<RouteServerItem>
    /** no user servers */
    isEmpty: boolean
    /** only set if isEmpty */
    emptyState?: RouteServersEmptyStateProps
    /** empty array hides the Known section */
    known: Array<KnownServerItem>
    manual: ManualEntryProps
    /** 'Routes come from the server's operator…' */
    trustNote: string
    /** 'Listed servers were checked to work…'. Only set if known is not empty */
    knownNote?: string
    removeDialog?: RemoveServerDialogProps
    /** key of the row just added. Cleared by the page service about 3 seconds later (followed by `page-update`) */
    highlightKey?: string
}
