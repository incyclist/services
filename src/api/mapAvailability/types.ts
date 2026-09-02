import type { TRideView } from '../../settings/display/ride/types'

export type AvailabilityStatus = 'available' | 'unavailable' | 'not-supported'

export interface AvailabilityResult {
    status: AvailabilityStatus
    messageKey?: string   // i18n key explaining what the user needs to do, when 'unavailable'
}

export interface IMapAvailabilityBinding {
    isAvailable(key: TRideView): AvailabilityResult   // sync, cached
    onChange(cb: (key: TRideView, result: AvailabilityResult) => void): void  // BLE-binding-style change event
}
