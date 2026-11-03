export type RideViewRestrictionCause = 'simulation'

export type RideViewRestrictionView = 'sv' | 'sat' | 'map'

/** Why the ride view of the running ride is limited to the Map */
export interface RideViewRestriction {
    cause: RideViewRestrictionCause
    /** the view the rider asked for (their saved preference, filtered by platform availability) */
    preferredView: RideViewRestrictionView
}

export interface RideViewRestrictionStartProps {
    simulated: boolean
    preferredView: RideViewRestrictionView
}

export type RideViewNoticeActionId = 'how-to' | 'dont-show-again' | 'change-this'

export interface RideViewRestrictionNoticeProps {
    /** stable for the whole ride, lets the app keep a single timer across message -> acknowledged */
    id: number
    state: 'message' | 'acknowledged'
    /** absent in state 'acknowledged' */
    text?: string
    actions: Array<{ id: RideViewNoticeActionId; label: string }>
}

export interface RideViewDeviceOption {
    id: 'device'
    /** omitted on mobile */
    heading?: string
    text: string
    /** only while a ride is running */
    discard?: {
        label: string
        confirm: { question: string; confirmLabel: string; cancelLabel: string }
    }
}

export interface RideViewOwnKeyOption {
    id: 'own-key'
    heading: string
    text: string
    /** replaced by pendingRestart once a key was saved in this session */
    addKey?: { label: string }
    helpLink: { label: string; url: string }
    pendingRestart?: { text: string }
}

export interface RideViewRestrictionDialogProps {
    title: string
    body: string
    /** own-key is only offered on the desktop channel */
    options: Array<RideViewDeviceOption | RideViewOwnKeyOption>
    /** only while a restricted ride is running */
    reminder?: { label: string; checked: boolean }
}
