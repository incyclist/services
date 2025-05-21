export type SatelliteViewEvent  = 'Loaded'|'Error'

export type StreetViewEvent = 'Loaded'|'Error'|'position_changed'|'pano_changed'|'status_changed'|'pov_changed'|'visible_changed'

export type MapViewPort = {
    center?: Array<number>
    zoom: number
}
