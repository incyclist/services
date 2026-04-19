import { IncyclistDeviceAdapter  } from "incyclist-devices";

import type { ICyclingMode,CyclingModeProperty,CyclingModeProperyType,Settings  } from "incyclist-devices";

import { ExtendedIncyclistCapability } from "../app";

export interface AdapterInfo {
    udid: string
    adapter: IncyclistDeviceAdapter
    capabilities: ExtendedIncyclistCapability[]
    isControl?: boolean
}

export interface DeviceModeInfo {
    udid: string
    mode: string
    isERG?: boolean,
    isSIM?: boolean
     
    settings: any
    options?: ICyclingMode[]
}

export type {ICyclingMode,CyclingModeProperty,CyclingModeProperyType,Settings }