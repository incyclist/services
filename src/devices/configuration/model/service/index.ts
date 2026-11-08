import { IncyclistDeviceAdapter  } from "incyclist-devices";

import type { ICyclingMode,CyclingModeProperty,CyclingModeProperyType,Settings  } from "incyclist-devices";

import { ExtendedIncyclistCapability } from "../app";
import { IncyclistDeviceSettings } from "../repository";

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

/**
 * A stored device for which no adapter could be created at startup
 * - `no-adapter`: the adapter factory returned nothing (interface/protocol not supported by this build)
 * - `create-failed`: the adapter factory threw (`error` holds the message)
 */
export interface UnbuildableDevice {
    udid: string
    settings: IncyclistDeviceSettings
    reason: 'no-adapter' | 'create-failed'
    error?: string
}

export type {ICyclingMode,CyclingModeProperty,CyclingModeProperyType,Settings }