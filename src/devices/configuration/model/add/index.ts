import { IncyclistCapability } from "incyclist-devices"

/**
 * Why `add()` put a device into an empty slot:
 * - `control`: the device can control resistance (a trainer), so it fills every empty slot it supports
 * - `heartrate`: a heart-rate monitor filling the empty Heartrate slot
 * - `new-rule`: any other device filling an empty slot it supports (e.g. a power meter filling Power) -
 *   `control` and `heartrate` already auto-filled before this; this value marks a fill that only
 *   happens now that every device fills what it supports, not just those two
 */
export type AutoSelectRule = 'control' | 'heartrate' | 'new-rule'

/** What `DeviceConfigurationService.addDevice()` did with the device. */
export interface AddDeviceResult {
    /** the device's udid; `undefined` if no adapter could be created for the settings */
    udid?: string
    /** capabilities whose device list did not contain this device before this call */
    newlyKnown: IncyclistCapability[]
    /** empty slots this call filled with the device, and why */
    autoSelected: Array<{ capability: IncyclistCapability, rule: AutoSelectRule }>
}
