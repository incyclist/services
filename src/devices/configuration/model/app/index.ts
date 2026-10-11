import { ExclusionReason, ExclusionScope } from "../exclusion"

export type ExtendedIncyclistCapability = 'control' |'power'| 'speed' | 'cadence' |'heartrate'|'bike' | 'app_control';

export interface DeviceInformation {
    udid: string;
    name: string;
    interface: string;
    selected: boolean;
    mode?: string;
     
    modeSetting?: any;
}


export interface CapabilityInformation{
    capability: ExtendedIncyclistCapability,
    devices: DeviceInformation[]
    disabled: boolean
    excluded?: { reason: ExclusionReason, scope: ExclusionScope }
}


export interface DeviceConfigurationInfo {[index: string]: CapabilityInformation}
