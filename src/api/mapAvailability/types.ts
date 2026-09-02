import type { TRideView } from '../../settings/display/ride/types'

export type AvailabilityStatus = 'available' | 'unavailable' | 'not-supported'

export interface AvailabilityResult {
    status: AvailabilityStatus
    messageKey?: string   // internal reason code, when 'unavailable' - resolved to display text by services, never exposed to the UI layer as-is
}

export interface IMapAvailabilityBinding {
    isAvailable(key: TRideView): AvailabilityResult   // sync, cached
    onChange(cb: (key: TRideView, result: AvailabilityResult) => void): void  // BLE-binding-style change event
}
