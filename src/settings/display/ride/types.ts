
export type TRideView = 'sv'|'sat'|'map'

export interface TRideViewOption {
    label: string
    disabled?: boolean
    message?: string
    /** set when the option is disabled because of the running ride (not because of the platform) */
    reason?: 'simulation'
}

export interface TVideoOption {
    enableAudio: boolean
}

export interface RideSettingsDisplayProps  {
    rideView: TRideView
    rideViewOptions: Map<TRideView,TRideViewOption>
    /** only while the ride view of the running ride is restricted: link text that explains how to lift it */
    rideViewHelp?: { label: string }
    showVideo?:boolean
    videoOptions?: TVideoOption
}