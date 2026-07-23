export type FeatureToggle = 'NEW_SEARCH_UI' | 'CONTROLLERS' | 'MOBILE_WORKOUTS' | 'WEBBLE_WINDOWS' | 'MOBILE_NEXT_VIDEO'

export type Interfaces = 'ant'|'ble'|'serial'|'wifi'|'tcpip'

export type BLEFeatures = {
    services: Array<string>
    characteristics:  Array<string>
}

export type WifiFeatures = BLEFeatures


export type AppFeatures = {
    interfaces: Array<Interfaces> | '*',
    ble: BLEFeatures | '*',
    wifi: WifiFeatures | '*'
}