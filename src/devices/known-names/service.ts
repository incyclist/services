import { KNOWN_DEVICE_NAMES } from './known-device-names'
import { KnownDeviceNames } from './types'

/**
 * The list of known trainer and sensor names, to be handed to platform bindings that keep a block list of devices that
 * are not worth probing (the WebBLE binding of the desktop app).
 *
 * @returns a copy: callers cannot change the list
 */
export const getKnownDeviceNames = (): KnownDeviceNames => ({
    version: KNOWN_DEVICE_NAMES.version,
    names: [...KNOWN_DEVICE_NAMES.names],
})
