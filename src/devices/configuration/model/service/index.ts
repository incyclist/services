import { IncyclistDeviceAdapter } from "incyclist-devices";
import { ExtendedIncyclistCapability } from "../app";

export interface AdapterInfo {
    udid: string
    adapter: IncyclistDeviceAdapter
    capabilities: ExtendedIncyclistCapability[]
}

export interface DeviceModeInfo {
    udid: string
    mode: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    settings: any
    options?: string[]
}