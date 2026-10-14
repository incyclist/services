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
    /**
     * Set only when the capability's one persisted selection (not any single entry in `devices`)
     * is currently excluded; recomputed fresh on every read by
     * `DeviceConfigurationService.findExclusion()`, so it can never lag behind a selection change.
     */
    excluded?: { reason: ExclusionReason, scope: ExclusionScope }
}


export interface DeviceConfigurationInfo {[index: string]: CapabilityInformation}
