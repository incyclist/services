import { StartOverlayProps } from "../types"

export type SatelliteViewEvent  = 'Loaded'|'Error'

export type StreetViewEvent = 'Loaded'|'Error'|'position_changed'|'pano_changed'|'status_changed'|'pov_changed'|'visible_changed'

export type MapViewPort = {
    center?: Array<number>
    zoom: number
}

export type RideMapType = 'StreetView' | 'SatelliteView' | 'MapView'
export type RideMapState = 'Loading' | 'Loaded' | 'Error'

export interface GPXStartOverlayProps extends StartOverlayProps {
    mapType: RideMapType,
    mapState: RideMapState,
    mapStateError: string
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