import type { Sport } from 'incyclist-devices'
export type * from './page/types'
export type * from './ride/types'
export type * from './configuration/types'

export type {Sport}

// BLE binding contract: platform bindings (e.g. mobile) implement these and must stay in sync with
// what incyclist-devices expects, so they are re-exported instead of being re-declared by the apps
export type {
    BleInterfaceState, BleProperty, BleCharacteristic, BleRawCharacteristic, BleService, DiscoverResult,
    BleBinding, BleRawPeripheral
} from 'incyclist-devices'
