
export type TRideView = 'sv'|'sat'|'map'

export interface TRideViewOption {
    label: string
    disabled?: boolean
    message?: string
}

export interface RideSettingsDisplayProps  {
    rideView: TRideView
    rideViewOptions: Map<TRideView,TRideViewOption>
}