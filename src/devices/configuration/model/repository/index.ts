import {SerialDeviceSettings, AntDeviceSettings, BleDeviceSettings} from 'incyclist-devices'
import { ExtendedIncyclistCapability } from '../app'

export type IncyclistDeviceSettings = SerialDeviceSettings | AntDeviceSettings | BleDeviceSettings
export * from './legacy'

// repository interfaces

export interface DeviceListEntry {
    udid: string,
    settings: IncyclistDeviceSettings,
    displayName?: string,
    mode?:string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    modes?:{ [index:string]:any  }
}

export interface InterfaceSetting {
    name: string;
    enabled: boolean;
    port?: number|string;
    protocol?: string
    invisible?: boolean
}

export interface ModeListEntry {
    mid: string;
    mode: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setting: any
}

export type CapabilitySetting = {
    selected: string | undefined
    capability: ExtendedIncyclistCapability
    disabled?: boolean
    devices:string[];
}

export interface DeviceConfigurationSettings {
    interfaces?: InterfaceSetting[]
    capabilities?: CapabilitySetting[]
    devices?: DeviceListEntry[]
    
}


