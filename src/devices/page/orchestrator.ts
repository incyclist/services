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
