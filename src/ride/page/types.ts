import { IPageService } from "../../base/pages"
import { Route } from "../../routes/base/model/route"
import { IObserver } from "../../types"
import { CurrentRideState, GPXStartOverlayProps, RideType, StartOverlayProps, VideoDisplayProps, VideoStartOverlayProps } from "../types"

// Base -- common to all ride types
export interface RidePageDisplayProps {
    rideState:         CurrentRideState
    rideType:          RideType
    startOverlayProps: StartOverlayProps | GPXStartOverlayProps | VideoStartOverlayProps | null
    menuProps:         RideMenuProps | null
    route?:            Route
}

// Video ride -- extends base with video-specific props
export interface VideoRidePageDisplayProps extends RidePageDisplayProps {
    video?:   VideoDisplayProps        // single video
    videos?:  VideoDisplayProps[]      // next-video chain (all loaded, hidden except active)
}

// GPX / Free-Ride -- to be defined when those pages are built
// interface GPXRidePageDisplayProps extends RidePageDisplayProps { ... }
// interface FreeRidePageDisplayProps extends RidePageDisplayProps { ... }

// Union for consumers that need to handle all ride types
export type AnyRidePageDisplayProps =
    | VideoRidePageDisplayProps
    | RidePageDisplayProps           // fallback / future types

export interface RideMenuProps {
    showResume: boolean   // true = Resume button, false = Pause button
}

interface RidePageCallbacks {
    onMenuOpen:    () => void
    onMenuClose:   () => void

    onPause:       () => void
    onResume:      () => void
    onEndRide:     () => void

    onRetryStart:  () => void
    onIgnoreStart: () => void
    onCancelStart: () => void
}

export interface IRidePageService extends RidePageCallbacks, IPageService{
    getRideObserver(): IObserver|null
    getPageDisplayProps(): AnyRidePageDisplayProps

}