import {IncyclistCapability} from 'incyclist-devices'


export interface DeviceInformation {
    udid: string;
    name: string,
    selected: boolean;
}


export interface CapabilityInformation{
    capability: IncyclistCapability | 'bike',
    devices: DeviceInformation[]
    disabled: boolean
}


export interface DeviceConfigurationInfo {[index: string]: CapabilityInformation}