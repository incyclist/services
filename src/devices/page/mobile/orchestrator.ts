import { PairingPageStateMachine } from './statemachine'
import type { PairingOrchestrator } from '../base/orchestrator'

/**
 * The orchestrator used by the mobile pairing page: today's page state machine with usage 'page'.
 * Constructed on demand, so this module does not need the state machine class at load time.
 */
export const createStateMachineOrchestrator = (): PairingOrchestrator => new PairingPageStateMachine()
