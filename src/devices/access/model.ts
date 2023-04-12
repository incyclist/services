import { IncyclistCapability} from "incyclist-devices"


export type InterfaceState = 'connected'| 'disconnected' | 'unknown' | 'connecting' | 'disconnecting' | 'unavailable'
export type ScanState = 'start-requested' | 'started' | 'stop-requested' | 'stopped' | 'idle'

/*
 * Provides the information about a single Interface
*/
export interface InterfaceInfo {
    /** name of the interface */
    name:string

    /**  is the interface enabled by the user/system */
    enabled:boolean

    /** connection state, only when state is 'connected', the interface is ready to be used  */
    state: InterfaceState

    /** provides information if the interface is currently performing a scan */
    isScanning: boolean;

    /** additional properties provided to the Interface ( e.g. timeouts, protocol for SerialInterface, ...) */
    properties?:InterfaceAccessProps
}

/*
 * Additional information that can be provided for an Interface
 *
 * This can be provided as default for all interfaces, or for every interface individually. 
 * The individual settings overwrite the default.
*/

export interface InterfaceAccessProps {
    /** Timeout for a connect attempt */
    connectTimeout?: number;

    /** Timeout for a scan attempt */
    scanTimeout?:number;

    /** TCP Port (only relevant for 'tcpip' interface) */
    port?: number

    /** Protocol to be used (only relevant for 'tcpip' and 'serial' interface) */
    protocol?: string;

    /** If set to `true` the service will continously try to connect to this interface, otherwise [[connect]] needs to be explicitely called */
    autoConnect?: boolean
}


export interface InterfaceList {[index: string]: InterfaceInfo}


export interface ScanFilter {
    interfaces?: string[],
    capabilities?: (IncyclistCapability|'bike')[]
    protocol?: string
    protocols?: string[]
    profile?: string
    excludeDisabled?: boolean
}


