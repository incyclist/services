import {IncyclistCapability} from 'incyclist-devices'

export type ExtendedIncyclistCapability = IncyclistCapability|'bike'

export interface DeviceInformation {
    udid: string;
    name: string;
    interface: string;
    selected: boolean;
    mode?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    modeSetting?: any;
}


export interface CapabilityInformation{
    capability: ExtendedIncyclistCapability,
    devices: DeviceInformation[]
    disabled: boolean
}


export interface DeviceConfigurationInfo {[index: string]: CapabilityInformation}

//export interface InterfaceInfo { }