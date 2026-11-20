import type { RouteServerStatus } from '../../types'

/** where the user came from: drives what Back and Close do */
export type RouteServersOrigin = 'settings' | 'import'

export type RouteServersView = 'list' | 'add' | 'add-manual'   // 'add-manual' = phone second step

export interface RouteServerItem {
    /** storage key = the display name */
    key: string
    /** display name, as normalised by the validator */
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
    /** after a successful check */
    routeCount?: number
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
    /** 'checked' = probe OK, waiting for Add (two-step entry, or after an http switch) */
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
    /** row just added */
    highlightKey?: string
}
