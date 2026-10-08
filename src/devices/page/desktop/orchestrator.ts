import type { PageState, SelectState } from '../base/types'
import type { PairingOrchestrator } from '../base/orchestrator'

/**
 * The orchestrator used by the desktop pairing page: wraps today's `DevicePairingService`
 * `usage:'direct'` `run()` loop, unchanged - `DevicePairingService.start()` already drives its
 * own self-contained scan/pair loop when `usage==='direct'`, so there is nothing for this
 * orchestrator to trigger itself. Desktop's device-list scan also bypasses the orchestrator
 * entirely (`DesktopPairingPageService` drives it directly via
 * `startDeviceSelection()`/`stopDeviceSelection()`), so the selection hooks are no-ops too.
 */
class DirectOrchestrator implements PairingOrchestrator {
    readonly state: PageState = 'Idle'
    readonly selectState: SelectState = 'Closed'

    start(_onUpdate: () => void): void {
        // no-op: DesktopPairingPageService.start() sets usage='direct' and calls
        // DevicePairingService.start(), which runs its own loop without this orchestrator's help.
    }
    stop(): void {
        // no-op, see start()
    }
    async pause(): Promise<void> {
        // no-op: desktop has no background/pause concept (today's page.jsx has none either)
    }
    resume(): void {
        // no-op, see pause()
    }
    onDeviceSelectionOpened(): void {
        // no-op: desktop drives device selection directly, not through the orchestrator
    }
    onDeviceSelectionClosed(): void {
        // no-op, see onDeviceSelectionOpened()
    }
}

export const createDirectOrchestrator = (): PairingOrchestrator => new DirectOrchestrator()
