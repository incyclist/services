import { CyclingMode, IncyclistDeviceAdapter } from "incyclist-devices";
import { ExtendedIncyclistCapability } from "../app";

export interface AdapterInfo {
    udid: string
    adapter: IncyclistDeviceAdapter
    capabilities: ExtendedIncyclistCapability[]
}

export interface DeviceModeInfo {
    udid: string
    mode: string
    isERG?: boolean,
    isSIM?: boolean
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    settings: any
    options?: CyclingMode[]
}