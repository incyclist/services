import {SerialDeviceSettings, AntDeviceSettings, BleDeviceSettings, IncyclistCapability} from 'incyclist-devices'

export type IncyclistDeviceSettings = SerialDeviceSettings | AntDeviceSettings | BleDeviceSettings
export * from './legacy'

// repository interfaces

export interface DeviceListEntry {
    udid: string
    settings: IncyclistDeviceSettings
    displayName?: string
}

export interface InterfaceSetting {
    name: string;
    enabled: boolean;
    protocol?: string
}

export type CapabilitySetting = {
    selected: string | undefined
    capability: IncyclistCapability | 'bike'
    disabled?: boolean
    devices:string[];
}

export interface DeviceConfigurationSettings {
    interfaces?: InterfaceSetting[]
    capabilities?: CapabilitySetting[]
    devices?: DeviceListEntry[]
}


