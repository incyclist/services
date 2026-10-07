import type { InterfaceState } from "../../access"
import type { InterfaceSetting } from "../../configuration/model"
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

/**
 * Props for the `InterfaceSettings` dialog (ANT+/BLE/serial/TCP-IP/WiFi), shown when
 * `showInterfaceSettings` is set. `protocols` is only non-empty for serial/TCP-IP (desktop's
 * `DeviceAccessService.getProtocols()`); `onOK` persists the change and closes the dialog.
 */
export type DesktopInterfaceSettingsDisplayProps = {
    name: string
    protocols?: Array<string>
    enabled: boolean
    protocol?: string
    port?: number|string
    onOK: (settings:InterfaceSetting)=>void
    onClose: ()=>void
}

export type DesktopPairingDisplayProps = Omit<PairingDisplayProps,'interfaces'|'showInterfaceSettings'> & {
    interfaces?: Array<DesktopInterfaceDisplayProps>
    showInterfaceSettings?: DesktopInterfaceSettingsDisplayProps
}
