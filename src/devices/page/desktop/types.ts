import type { InterfaceState } from "../../access"
import type { PairingDisplayProps } from "../base/types"

/**
 * Desktop interface tile props: unlike mobile's 4-state mapping, desktop shows the raw
 * `InterfaceState` plus `isScanning`/`enabled`/`protocol`/`port` for every interface
 * (ANT+, BLE, serial, TCP/IP, WiFi), matching today's `web-ui` interface strip.
 */
export type DesktopInterfaceDisplayProps = {
    name: string
    state: InterfaceState
    isScanning: boolean
    enabled: boolean
    protocol?: string
    port?: number|string
    onClick: ()=>void
}

export type DesktopPairingDisplayProps = Omit<PairingDisplayProps,'interfaces'> & {
    interfaces?: Array<DesktopInterfaceDisplayProps>
    labelOK?: string
    labelSkip?: string
    showSimulate?: boolean
}
