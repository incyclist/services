import { PairingPageStateMachine } from './statemachine'
import type { PageState, SelectState } from './types'

/**
 * Drives the pairing lifecycle for a pairing page. The method names match the state machine,
 * so page services can use either implementation without knowing which one is in place.
 */
export interface PairingOrchestrator {
    readonly state: PageState
    readonly selectState: SelectState
    start(onUpdate: ()=>void): void
    stop(): Promise<void> | void
    pause(): Promise<void>
    resume(): void
    onDeviceSelectionOpened(onSelectionStateChanged: ()=>void): void
    onDeviceSelectionClosed(): Promise<void> | void
}

/**
 * The orchestrator used by the mobile pairing page: today's page state machine with usage 'page'.
 * Constructed on demand, so this module does not need the state machine class at load time.
 */
export const createStateMachineOrchestrator = (): PairingOrchestrator => new PairingPageStateMachine()

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
