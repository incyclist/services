
export type TRideView = 'sv'|'sat'|'map'

export interface RideSettingsDisplayProps  {
    rideView: TRideView
    rideViewOptions: Map<TRideView,string>
}