import { IncyclistDeviceAdapter } from "incyclist-devices";

const PAIRING_START_TIMEOUT_MS = 10*1000
const BLE_PAIRING_START_TIMEOUT_MS = 30*1000

/**
 * The time a device is given to connect when it is started for pairing.
 *
 * @param adapter the device's adapter
 * @returns the timeout in ms: BLE devices get longer than devices on any other interface
 */
export const getPairingStartTimeout = (adapter:IncyclistDeviceAdapter):number => {
    return adapter?.getSettings?.()?.interface==='ble' ? BLE_PAIRING_START_TIMEOUT_MS : PAIRING_START_TIMEOUT_MS
}

/** The time a running start of a device is given to stop, before it is restarted by a per-device retry */
export const DEVICE_RETRY_STOP_TIMEOUT_MS = 5*1000
