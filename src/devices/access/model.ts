import { IncyclistCapability, IncyclistInterface} from "incyclist-devices"
import { IncyclistScanProps } from "incyclist-devices/lib/types/device"

export interface InterfaceInfo {
    enabled:boolean
    interface: IncyclistInterface
}

export interface InterfaceList {[index: string]: InterfaceInfo}


export interface ScanFilter {
    interfaces?: string[],
    capabilities?: (IncyclistCapability|'bike')[]
    protocol?: string
    
}