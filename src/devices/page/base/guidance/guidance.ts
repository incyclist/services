import { IncyclistCapability } from 'incyclist-devices'

import { isCapabilityActive } from '../../../pairing/capability'
import { PARTIAL_OUTAGE_DEBOUNCE_MS } from '../../../pairing/guidance'
import { getPairingStatusDisplay, getPartialOutageHint } from '../../../pairing/status'
import type { CapabilityData, PairingState } from '../../../pairing/model'
import type { PairingHint, PairingInterfaceId, PairingStatusId } from '../../../pairing/guidance'
import type { PairingStatusDisplayProps, PairingStatusSource } from '../../../pairing/status'
import type {
    PairingCase, PairingGuidanceDeps, PairingGuidanceExitFields, PairingGuidanceState, PartialOutage, TrainerPhase, TrainerPhaseCause
} from './types'

/** Logged on every trainer phase change, with `fromPhase`, `toPhase`, `cause`, `attemptMs` and `interface`. */
export const TRAINER_PHASE_EVENT = 'pairing trainer phase changed'

/** Logged once per visit when the first-use partial-outage hint first shows. */
export const PARTIAL_OUTAGE_EVENT = 'pairing partial outage shown'

const PARTIAL_OUTAGE_BY_HINT: Record<PairingHint, PartialOutage> = {
    'bluetooth-permission': { interface: 'ble', reason: 'permission' },
    'bluetooth-off': { interface: 'ble', reason: 'off' },
    'ant': { interface: 'ant', reason: 'not-found' },
}

/**
 * How long a configured trainer gets to connect before it counts as unavailable: the adapter's
 * own pairing timeout on that interface plus a margin. It's a backstop for attempts that hang
 * without ever reporting an error.
 */
export const TRAINER_ATTEMPT_TIMEOUT_MS: Readonly<Record<PairingInterfaceId, number>> = {
    ble: 35000,
    ant: 15000,
    serial: 15000,
    tcpip: 15000,
    wifi: 15000,
}

// an interface without its own value gets the longest one, so the backstop never fires early
const DEFAULT_TRAINER_ATTEMPT_TIMEOUT_MS = Math.max(...Object.values(TRAINER_ATTEMPT_TIMEOUT_MS))

const CASE_BY_PHASE: Record<TrainerPhase, PairingCase> = {
    connecting: 'trainer-connecting',
    connected: 'trainer-connected',
    unavailable: 'trainer-unavailable',
}

/**
 * Per-visit guidance state of the Pairing page, fed by the pairing state and by the page's visit
 * lifecycle (open, close, pause, resume). Visit counting and persistence stay with the visit
 * tracker; this class only follows the visit.
 *
 * It tracks the configured trainer's connection attempt: the page treats a trainer as unavailable
 * only once its attempt has failed or timed out, never merely because it hasn't connected yet.
 * Once unavailable, the trainer stays so through background retries until it actually connects.
 */
export class PairingGuidance {

    protected readonly deps: PairingGuidanceDeps

    protected visitOpen = false
    protected paused = false

    protected trainerConfigured = false
    protected trainerUdid?: string
    protected trainerInterface?: string
    protected lastConnectState?: string
    protected phase?: TrainerPhase

    // the running attempt: its timeout, and its active (not backgrounded) time so far
    protected attemptTimeoutMs?: number
    protected attemptElapsedMs = 0
    protected attemptResumedAt?: number
    protected attemptTimer?: ReturnType<typeof setTimeout>

    protected visitId?: string
    protected openedAt = 0

    // the first-use partial outage: since when it holds, its hold timer, and what was shown this visit
    protected partialOutageSince?: number
    protected partialOutageTimer?: ReturnType<typeof setTimeout>
    protected partialOutageShown?: PartialOutage
    protected lastStatusId?: PairingStatusId

    /**
     * @param deps where events are logged, and who is told when the state changes on its own
     */
    constructor(deps: PairingGuidanceDeps) {
        this.deps = deps
    }

    /**
     * Starts a visit: the trainer and the status line are evaluated from scratch.
     *
     * @param options `visitId`: the id the visit tracker gave this visit, for the events of this visit
     */
    openVisit({ visitId }: { visitId?: string } = {}): void {
        this.reset()
        this.visitOpen = true
        this.visitId = visitId
        this.openedAt = Date.now()
    }

    /** Ends the visit: nothing is tracked, and no timer runs, until the next {@link openVisit}. */
    closeVisit(): void {
        this.reset()
    }

    /** The app went to the background: the attempt timer stops, and pairing states are ignored. */
    pauseVisit(): void {
        if (!this.visitOpen || this.paused)
            return
        this.paused = true
        this.stopAttemptClock()
        this.clearAttemptTimer()
        // the partial outage is held again from scratch once the app is back and the page is ready
        this.clearPartialOutage()
    }

    /** The app is back: the attempt timer runs on for the time it had left. */
    resumeVisit(): void {
        if (!this.visitOpen || !this.paused)
            return
        this.paused = false
        if (this.attemptTimeoutMs !== undefined)
            this.attemptResumedAt = Date.now()
        this.armAttemptTimer()
    }

    /**
     * Takes in the current pairing state.
     *
     * @param state the full pairing state, as emitted with `pairing-state`
     */
    onPairingState(state: PairingState): void {
        if (!this.visitOpen || this.paused)
            return

        const control = state?.capabilities?.find(c => c.capability === IncyclistCapability.Control)
        this.trainerConfigured = isCapabilityActive(control)
        if (!this.trainerConfigured) {
            this.endTrainer()
            return
        }

        if (this.phase === undefined || control.selected !== this.trainerUdid) {
            this.startTrainer(control)
            return
        }

        this.trainerInterface = control.interface ?? this.trainerInterface
        this.onTrainerConnectState(control.connectState)
    }

    /** The rider says the trainer isn't available: while it's still connecting, that's the outcome. */
    onTrainerUnavailable(): void {
        if (this.visitOpen && this.phase === 'connecting')
            this.moveTo('unavailable', 'rider')
    }

    /** The current guidance state. */
    getState(): PairingGuidanceState {
        const trainerPhase = this.trainerConfigured ? this.phase : undefined
        const pairingCase: PairingCase = trainerPhase ? CASE_BY_PHASE[trainerPhase] : 'no-trainer'
        return { trainerConfigured: this.trainerConfigured, trainerPhase, pairingCase }
    }

    /**
     * The status line for the page's current state, with the trainer phase and the partial-outage hold
     * applied. A partial outage that starts to hold here asks for a page update once it has held long
     * enough to show.
     *
     * @param src the page's pairing state
     * @returns the status line's display props
     */
    getStatus(src: PairingStatusSource): PairingStatusDisplayProps {
        const hint = this.visitOpen && !this.paused ? getPartialOutageHint(src) : undefined
        this.trackPartialOutage(hint)

        const status = getPairingStatusDisplay({
            ...src,
            trainerPhase: this.getState().trainerPhase,
            partialOutageSince: this.partialOutageSince,
            now: Date.now(),
        })

        if (this.visitOpen) {
            this.lastStatusId = status.id
            if (status.id === 'S1b' && hint)
                this.onPartialOutageShown(src, hint)
        }
        return status
    }

    /** What this visit adds to the `pairing page left` event. */
    getExitFields(): PairingGuidanceExitFields {
        const { pairingCase, trainerPhase } = this.getState()
        const fields: PairingGuidanceExitFields = {
            pairingCase,
            partialOutageShown: this.partialOutageShown !== undefined,
            switchedOffRequired: this.lastStatusId === 'S8',
        }
        if (trainerPhase)
            fields.trainerPhase = trainerPhase
        if (this.partialOutageShown) {
            fields.partialOutageInterface = this.partialOutageShown.interface
            fields.partialOutageReason = this.partialOutageShown.reason
        }
        return fields
    }

    protected trackPartialOutage(hint: PairingHint | undefined): void {
        if (!hint) {
            this.clearPartialOutage()
            return
        }
        if (this.partialOutageSince !== undefined)
            return

        this.partialOutageSince = Date.now()
        this.partialOutageTimer = setTimeout(() => { this.onPartialOutageHeld() }, PARTIAL_OUTAGE_DEBOUNCE_MS)
    }

    protected onPartialOutageHeld(): void {
        delete this.partialOutageTimer
        try {
            this.deps.onChange()
        }
        catch {
            // a failing page update must not leave the timer callback throwing
        }
    }

    protected clearPartialOutage(): void {
        if (this.partialOutageTimer)
            clearTimeout(this.partialOutageTimer)
        delete this.partialOutageTimer
        delete this.partialOutageSince
    }

    // logged only the first time this visit; strings and numbers only, never a device id or name
    protected onPartialOutageShown(src: PairingStatusSource, hint: PairingHint): void {
        if (this.partialOutageShown)
            return
        this.partialOutageShown = PARTIAL_OUTAGE_BY_HINT[hint]

        const fields: Record<string, unknown> = {}
        if (this.visitId !== undefined)
            fields.visitId = this.visitId
        fields.platform = src.platform
        fields.interface = this.partialOutageShown.interface
        fields.reason = this.partialOutageShown.reason
        fields.msSinceOpen = Date.now() - this.openedAt
        this.safeLog(PARTIAL_OUTAGE_EVENT, fields)
    }

    protected safeLog(message: string, fields: Record<string, unknown>): void {
        try {
            this.deps.log(message, fields)
        }
        catch {
            // logging must never interfere with pairing
        }
    }

    protected startTrainer(control: CapabilityData): void {
        this.stopAttempt()
        this.trainerUdid = control.selected
        this.trainerInterface = control.interface
        this.lastConnectState = control.connectState

        if (control.connectState === 'connected') {
            this.phase = 'connected'
            return
        }
        this.phase = 'connecting'
        this.startAttempt()
    }

    protected endTrainer(): void {
        this.stopAttempt()
        delete this.phase
        delete this.trainerUdid
        delete this.trainerInterface
        delete this.lastConnectState
    }

    protected onTrainerConnectState(connectState: string | undefined): void {
        const previous = this.lastConnectState
        this.lastConnectState = connectState
        const connected = connectState === 'connected'

        if (this.phase === 'connected') {
            if (!connected)
                this.moveTo('connecting', 'dropped')
            return
        }

        if (connected) {
            this.moveTo('connected', 'connected')
            return
        }

        // only a change to 'failed' is a pairing error of this attempt, not one that is left over
        if (this.phase === 'connecting' && connectState === 'failed' && previous !== 'failed')
            this.moveTo('unavailable', 'pair_error')
    }

    protected moveTo(toPhase: TrainerPhase, cause: TrainerPhaseCause): void {
        const fromPhase = this.phase
        const attemptMs = this.attemptTimeoutMs === undefined ? undefined : this.getAttemptElapsedMs()

        this.phase = toPhase
        if (toPhase === 'connected')
            this.stopAttempt()
        else if (toPhase === 'connecting')
            this.startAttempt()
        else
            this.clearAttemptTimer()

        this.logPhaseChange({ fromPhase, toPhase, cause, attemptMs })
    }

    protected logPhaseChange({ fromPhase, toPhase, cause, attemptMs }: { fromPhase: TrainerPhase, toPhase: TrainerPhase, cause: TrainerPhaseCause, attemptMs?: number }): void {
        // strings and numbers only, never a device id or name
        const fields: Record<string, unknown> = { fromPhase, toPhase, cause }
        if (attemptMs !== undefined)
            fields.attemptMs = attemptMs
        fields.interface = this.trainerInterface ?? 'unknown'
        this.safeLog(TRAINER_PHASE_EVENT, fields)
    }

    protected startAttempt(): void {
        this.clearAttemptTimer()
        this.attemptTimeoutMs = this.getAttemptTimeoutMs()
        this.attemptElapsedMs = 0
        this.attemptResumedAt = this.paused ? undefined : Date.now()
        this.armAttemptTimer()
    }

    protected stopAttempt(): void {
        this.clearAttemptTimer()
        delete this.attemptTimeoutMs
        delete this.attemptResumedAt
        this.attemptElapsedMs = 0
    }

    protected getAttemptTimeoutMs(): number {
        return TRAINER_ATTEMPT_TIMEOUT_MS[this.trainerInterface as PairingInterfaceId] ?? DEFAULT_TRAINER_ATTEMPT_TIMEOUT_MS
    }

    protected getAttemptElapsedMs(): number {
        const running = this.attemptResumedAt === undefined ? 0 : Date.now() - this.attemptResumedAt
        return this.attemptElapsedMs + running
    }

    protected stopAttemptClock(): void {
        this.attemptElapsedMs = this.getAttemptElapsedMs()
        delete this.attemptResumedAt
    }

    protected armAttemptTimer(): void {
        this.clearAttemptTimer()
        if (this.paused || this.phase !== 'connecting' || this.attemptTimeoutMs === undefined)
            return
        const remaining = Math.max(0, this.attemptTimeoutMs - this.getAttemptElapsedMs())
        this.attemptTimer = setTimeout(() => { this.onAttemptTimeout() }, remaining)
    }

    protected clearAttemptTimer(): void {
        if (this.attemptTimer)
            clearTimeout(this.attemptTimer)
        delete this.attemptTimer
    }

    protected onAttemptTimeout(): void {
        delete this.attemptTimer
        try {
            if (this.phase !== 'connecting')
                return
            this.moveTo('unavailable', 'timer')
            this.deps.onChange()
        }
        catch {
            // a failing page update must not leave the timer callback throwing
        }
    }

    protected reset(): void {
        this.endTrainer()
        this.clearPartialOutage()
        this.visitOpen = false
        this.paused = false
        this.trainerConfigured = false
        delete this.visitId
        delete this.partialOutageShown
        delete this.lastStatusId
    }
}
