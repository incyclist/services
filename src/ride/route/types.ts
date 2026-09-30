import { StartOverlayProps } from "../types"

export type SatelliteViewEvent  = 'Loaded'|'Error'

export type StreetViewEvent = 'Loaded'|'Error'|'NoPanorama'|'position_changed'|'pano_changed'|'status_changed'|'pov_changed'|'visible_changed'

export type MapViewPort = {
    center?: Array<number>
    zoom: number
}

export type RideMapType = 'StreetView' | 'SatelliteView' | 'MapView'
export type RideMapState = 'Loading' | 'Loaded' | 'Error'

/**
 * Street View start-sub-state, see `GpxDisplayService`'s release/phase model (INC-42).
 * `released` is intentionally not part of this union - it is reported to the UI as `waiting`
 * for the duration of the anti-flicker window, so a fast load never flips the header.
 */
export type SvViewState = 'waiting' | 'loading' | 'slow' | 'loaded' | 'unavailable'

export type SvFallbackCause = 'timeout' | 'maps-api' | 'user'

export interface GPXStartOverlayProps extends StartOverlayProps {
    mapType: RideMapType,
    mapState: RideMapState,
    mapStateError?: string,
    /** Only populated when this start began with rideView==='sv' (INC-42). */
    viewState?: SvViewState,
    /** Only set when viewState==='unavailable'. */
    viewFallbackCause?: SvFallbackCause
}


export type RideVideoState = 'Starting'| 'Started' | 'Start:Failed' 
export interface RideVideoLoadProgress {
    loaded: boolean,
    bufferTime: number
}

export interface VideoStartOverlayProps extends StartOverlayProps {
    mapType: RideMapType,
    videoState: RideMapState|string,
    videoStateError: string
    videoProgress: RideVideoLoadProgress
}