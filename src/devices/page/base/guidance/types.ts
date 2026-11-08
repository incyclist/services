/**
 * Where the configured trainer is in its connection attempt during a Pairing page visit.
 * `unavailable` means the attempt has failed or timed out (or the rider said the trainer isn't
 * available). It stays that way through later retries until the trainer actually connects.
 */
export type TrainerPhase = 'connecting' | 'connected' | 'unavailable'

/**
 * The Pairing page's case: no trainer configured (any power meter or speed sensor will do), or a
 * configured trainer that is still connecting, has connected, or isn't available.
 */
export type PairingCase = 'no-trainer' | 'trainer-connecting' | 'trainer-unavailable' | 'trainer-connected'

/** What moved the trainer phase on. */
export type TrainerPhaseCause = 'connected' | 'pair_error' | 'timer' | 'rider' | 'dropped'

export interface PairingGuidanceState {
    /** a trainer is selected, switched on and not excluded for Resistance */
    trainerConfigured: boolean
    /** only set while a trainer is configured and a visit is open */
    trainerPhase?: TrainerPhase
    pairingCase: PairingCase
}

export interface PairingGuidanceDeps {
    /** writes one analytics event */
    log: (message: string, fields: Record<string, unknown>) => void
    /** called whenever the guidance state changed on its own, e.g. when a timer expired */
    onChange: () => void
}
