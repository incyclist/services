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
