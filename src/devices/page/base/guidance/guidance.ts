import { IncyclistCapability } from 'incyclist-devices'

import { isCapabilityActive } from '../../../pairing/capability'
import { PARTIAL_OUTAGE_DEBOUNCE_MS } from '../../../pairing/guidance'
import { getPairingStatusDisplay, getPartialOutageHint } from '../../../pairing/status'
import { getContinueWithoutDeviceAction, getPairingHelperReasons } from '../../../pairing/helper'
import type { CapabilityData, PairingState } from '../../../pairing/model'
import type { PairingHint, PairingInterfaceId, PairingInterfaceState, PairingPlatform, PairingStatusId, PairingTrainerRetry } from '../../../pairing/guidance'
import type { PairingStatusCapability, PairingStatusDisplayProps, PairingStatusSource } from '../../../pairing/status'
import type { ContinueWithoutDeviceAction, ContinueWithoutDeviceTarget, PairingHelperReason } from '../../../pairing/helper'
import type {
    PairingCase, PairingFallbackCapability, PairingGuidanceDeps, PairingGuidanceExitFields, PairingGuidanceState, PairingGuidanceVisitProps,
    PairingHelperCloseVia, PairingHelperPhase, PairingHelperState, PairingHelperTrigger, PartialOutage, RiderRetryResult, RiderRetryTrigger,
    TrainerPhase, TrainerPhaseCause
} from './types'

/** Logged on every trainer phase change, with `fromPhase`, `toPhase`, `cause`, `attemptMs` and `interface`. */
export const TRAINER_PHASE_EVENT = 'pairing trainer phase changed'

/** Logged once per visit when the first-use partial-outage hint first shows. */
export const PARTIAL_OUTAGE_EVENT = 'pairing partial outage shown'

/** Logged when the helper opens. */
export const HELPER_SHOWN_EVENT = 'pairing helper shown'

/** Logged on every answer the rider picks in the helper. */
export const HELPER_REASON_EVENT = 'pairing helper reason selected'

/** Logged when the rider takes the action under a tip. */
export const HELPER_ACTION_EVENT = 'pairing helper action'

/** Logged when a device made the row ready while the helper was open. */
export const HELPER_RESOLVED_EVENT = 'pairing helper resolved'

/** Logged on every other way the helper closes. */
export const HELPER_CLOSED_EVENT = 'pairing helper closed'

/** Logged when the rider chooses to ride on another device while the trainer isn't available, with `capability` and `msSinceOpen`. */
export const FALLBACK_CHOSEN_EVENT = 'pairing fallback chosen'

/** Logged when the rider takes the trainer back into use, with `capability`, `msSinceOpen` and `msSinceFallback`. */
export const FALLBACK_CANCELLED_EVENT = 'pairing fallback cancelled'

/**
 * Logged when the rider starts a connection attempt of their own, with `retryCapabilities`, `trigger`,
 * `retryIndex`, `msSinceUnavailable`, `separateDeviceConnected`, `helperOpen`, `pairingCase` and `platform`.
 */
export const RIDER_RETRY_EVENT = 'pairing trainer retry'

/** Logged when the rider's attempt ends, with `retryResult`, `durationMs`, `retryIndex`, `pairingCase` and `platform`. */
export const RIDER_RETRY_ENDED_EVENT = 'pairing trainer retry ended'

/** How long the page says resistance control is back on, after the trainer connected while the ride was on another device. */
export const FALLBACK_REVERTED_DISPLAY_MS = 3000

const NOT_AVAILABLE = { reason: 'not-available', scope: 'until-next-pairing' } as const

/**
 * How long the page waits before it offers the helper by itself, per platform: after most successful
 * searches, and before most riders give up. Active page time only: time in the background doesn't count.
 */
export const HELPER_THRESHOLD_MS: Readonly<Record<PairingPlatform, number>> = {
    mobile: 30000,
    desktop: 45000,
}

/** How long the helper says the row is ready before it hides. */
export const HELPER_RESOLVED_DISPLAY_MS = 2000

const REQUIRED_CAPABILITIES = ['control', 'power', 'speed']
const CAPABILITY_ORDER = ['control', 'power', 'speed', 'heartrate', 'cadence', 'app_control']

const isConnected = (c: PairingStatusCapability | undefined): boolean =>
    isCapabilityActive(c) && c?.connectState === 'connected'

const toInterfaceState = (i: PairingInterfaceState): string => {
    if (!i.enabled)
        return 'disabled'
    return i.available ? 'available' : 'unavailable'
}

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
    protected unavailableSince?: number

    // the attempt the rider started while the trainer can't be reached: its state, how many there
    // were this visit, and its own timer
    protected trainerRetry?: PairingTrainerRetry
    protected retryIndex = 0
    protected retryCase?: PairingCase
    protected retrySawConnecting = false
    protected retryStartFields?: Record<string, unknown>
    protected retryTimeoutMs?: number
    protected retryElapsedMs = 0
    protected retryResumedAt?: number
    protected retryTimer?: ReturnType<typeof setTimeout>

    // the ride falls back to another device: to what, instead of which trainer, and since when
    protected fallback?: { capability: PairingFallbackCapability, trainerUdid: string, since: number }
    // the trainer connected while the fallback was active; said for a moment
    protected fallbackReverted = false
    protected fallbackRevertedTimer?: ReturnType<typeof setTimeout>

    protected visitId?: string
    protected openedAt = 0

    // the first-use partial outage: since when it holds, its hold timer, and what was shown this visit
    protected partialOutageSince?: number
    protected partialOutageTimer?: ReturnType<typeof setTimeout>
    protected partialOutageShown?: PartialOutage
    protected lastStatusId?: PairingStatusId

    protected platform: PairingPlatform = 'desktop'
    protected forRide = false

    // the helper threshold: one clock per visit, counting active (not backgrounded) page time
    protected helperElapsedMs = 0
    protected helperResumedAt?: number
    protected helperTimer?: ReturnType<typeof setTimeout>
    protected thresholdReached = false

    // the helper itself
    protected helperPhase: PairingHelperPhase = 'hidden'
    protected helperShownAt?: number
    protected helperShown = false
    protected helperAutoOpened = false
    protected helperDismissed = false
    protected helperResolvedTimer?: ReturnType<typeof setTimeout>
    protected deviceListOpen = false
    protected selectedReason?: PairingHelperReason
    protected lastReason?: PairingHelperReason
    protected reasonSelections = 0

    // what the page showed when the status line was last evaluated
    protected rowReady = false
    protected readyCapability?: string
    protected connectedCapabilities = ''
    protected interfaceStates = ''
    protected separateSensor?: 'power' | 'speed'

    /**
     * @param deps where events are logged, and who is told when the state changes on its own
     */
    constructor(deps: PairingGuidanceDeps) {
        this.deps = deps
    }

    /**
     * Starts a visit: the trainer, the status line and the helper are evaluated from scratch, and the
     * helper threshold starts to run.
     *
     * @param props the visit id for this visit's events, the platform, and whether the page is opened for a ride
     */
    openVisit({ visitId, platform, forRide }: PairingGuidanceVisitProps = {}): void {
        this.reset()
        this.visitOpen = true
        this.visitId = visitId
        this.platform = platform ?? 'desktop'
        this.forRide = forRide ?? false
        this.openedAt = Date.now()
        this.helperResumedAt = Date.now()
        this.armHelperTimer()
    }

    /** Ends the visit: nothing is tracked, and no timer runs, until the next {@link openVisit}. */
    closeVisit(): void {
        if (this.visitOpen && this.helperPhase === 'open')
            this.logHelperClosed('page_left')
        if (this.visitOpen && this.trainerRetry === 'running')
            this.endRiderRetry('left_page')
        this.reset()
    }

    /** The app went to the background: the timers stop, and pairing states are ignored. */
    pauseVisit(): void {
        if (!this.visitOpen || this.paused)
            return
        this.paused = true
        this.stopAttemptClock()
        this.clearAttemptTimer()
        this.stopRetryClock()
        this.clearRetryTimer()
        this.stopHelperClock()
        this.clearHelperTimer()
        if (this.helperPhase === 'resolved')
            this.hideHelper()
        // the partial outage is held again from scratch once the app is back and the page is ready
        this.clearPartialOutage()
    }

    /** The app is back: the timers run on for the time they had left. */
    resumeVisit(): void {
        if (!this.visitOpen || !this.paused)
            return
        this.paused = false
        if (this.attemptTimeoutMs !== undefined)
            this.attemptResumedAt = Date.now()
        this.armAttemptTimer()
        if (this.retryTimeoutMs !== undefined)
            this.retryResumedAt = Date.now()
        this.armRetryTimer()
        this.helperResumedAt = Date.now()
        this.armHelperTimer()
    }

    /**
     * Takes in the current pairing state.
     *
     * @param state the full pairing state, as emitted with `pairing-state`
     */
    onPairingState(state: PairingState): void {
        if (!this.visitOpen || this.paused)
            return

        const previousConnectState = this.lastConnectState
        this.followTrainer(state)
        this.followRiderRetry(previousConnectState)
    }

    /** The rider says the trainer isn't available: while it's still connecting, that's the outcome. */
    onTrainerUnavailable(): void {
        if (this.visitOpen && this.phase === 'connecting')
            this.moveTo('unavailable', 'rider')
    }

    /**
     * What switching off the Resistance tile means right now. While the configured trainer is still
     * connecting or can't be reached, the rider is saying it isn't available today, so the helper opens
     * and nothing is switched off. Otherwise Resistance is switched off.
     */
    getResistanceUnselectAction(): 'open-helper' | 'unselect' {
        const { trainerPhase } = this.getState()
        const waitingForTrainer = trainerPhase === 'connecting' || trainerPhase === 'unavailable'
        return this.visitOpen && !this.fallback && waitingForTrainer ? 'open-helper' : 'unselect'
    }

    /**
     * The rider said the trainer isn't available today: a trainer that is still connecting is
     * unavailable from now on, and the helper opens (or stays open) with that answer picked.
     *
     * @param trigger what the rider used: the Resistance tile's switch, or the status line's link
     */
    openHelperForUnavailableTrainer(trigger: PairingHelperTrigger): void {
        if (!this.visitOpen)
            return
        this.onTrainerUnavailable()
        if (this.helperPhase !== 'open')
            this.showHelper(trigger)
        this.preselectReason('trainer_unavailable')
    }

    /** The current guidance state. */
    getState(): PairingGuidanceState {
        // while the ride falls back to another device, the trainer is excluded, but still the one the page waits for
        const trainerPhase = this.trainerConfigured || this.fallback ? this.phase : undefined
        const pairingCase: PairingCase = trainerPhase ? CASE_BY_PHASE[trainerPhase] : 'no-trainer'
        const state: PairingGuidanceState = { trainerConfigured: this.trainerConfigured, trainerPhase, pairingCase }
        if (this.trainerRetry)
            state.trainerRetry = this.trainerRetry
        if (this.fallback)
            state.fallback = { capability: this.fallback.capability }
        return state
    }

    /**
     * What the ride could fall back to right now: a separate power meter or speed sensor that is
     * connected, while the trainer can't be reached and no fallback is active yet.
     */
    getFallbackCandidate(): PairingFallbackCapability | undefined {
        if (!this.visitOpen || this.fallback || this.getState().trainerPhase !== 'unavailable')
            return undefined
        return this.separateSensor
    }

    /**
     * The rider chooses to ride on the fallback candidate: the trainer is excluded from every capability
     * it is selected for, until the Pairing page is next opened. An open helper closes at once.
     *
     * @returns whether the fallback was taken; never without a candidate or a configuration to exclude it in
     */
    chooseFallback(): boolean {
        const capability = this.getFallbackCandidate()
        const configuration = this.deps.configuration?.()
        const trainerUdid = this.trainerUdid
        if (!capability || !configuration || !trainerUdid)
            return false

        const now = Date.now()
        // set before the exclusion, so the pairing state it triggers already finds the fallback
        this.fallback = { capability, trainerUdid, since: now }
        try {
            configuration.excludeDevice(trainerUdid, NOT_AVAILABLE)
        }
        catch {
            delete this.fallback
            return false
        }

        this.closeHelperForFallback(capability)
        this.safeLog(FALLBACK_CHOSEN_EVENT, { capability, msSinceOpen: now - this.openedAt })
        return true
    }

    /**
     * The rider takes the trainer back into use while the fallback is active. The trainer still can't be
     * reached, so the page waits for it again.
     *
     * @returns whether there was a fallback to cancel
     */
    cancelFallback(): boolean {
        const fallback = this.fallback
        const configuration = this.deps.configuration?.()
        if (!this.visitOpen || !fallback || !configuration)
            return false

        delete this.fallback
        // the trainer is back in use; the next pairing state confirms it
        this.trainerConfigured = true

        const excluded = configuration.getExclusions()
            .filter(e => e.reason === NOT_AVAILABLE.reason && e.udid === fallback.trainerUdid)
        // Resistance first, so a pairing state that follows each step already finds the trainer in use
        const isControl = (e: { capability: IncyclistCapability }) => Number(e.capability === IncyclistCapability.Control)
        excluded.sort((a, b) => isControl(b) - isControl(a))
            .forEach(e => { configuration.includeCapability(e.capability) })

        const now = Date.now()
        this.safeLog(FALLBACK_CANCELLED_EVENT, { capability: fallback.capability, msSinceOpen: now - this.openedAt, msSinceFallback: now - fallback.since })
        return true
    }

    /**
     * A device excluded as not available connected while the visit is open, and was taken back into use.
     * If it is the trainer, the page says resistance control is back on for a moment.
     *
     * @param udid the device that was taken back into use
     */
    onFallbackReverted(udid: string): void {
        const trainerUdid = this.fallback?.trainerUdid ?? this.trainerUdid
        if (!this.visitOpen || udid !== trainerUdid)
            return
        delete this.fallback
        this.fallbackReverted = true
        this.clearFallbackRevertedTimer()
        this.fallbackRevertedTimer = setTimeout(() => { this.onFallbackRevertedShown() }, FALLBACK_REVERTED_DISPLAY_MS)
    }

    /**
     * The rider started a connection attempt of their own while the trainer can't be reached. The
     * attempt that is about to run (or already runs) becomes the rider's, with its own full timer from
     * now. It ends when the trainer connects, when the trainer fails after it was seen connecting since
     * the tap (a failure left over from an attempt that was already running doesn't count), or when its
     * timer expires. A failure or timeout then holds until the rider starts another one. The trainer
     * phase itself is never changed by it.
     *
     * @param props what the rider used
     * @returns whether the attempt started: only while the trainer can't be reached, no fallback is
     * active and no other attempt of the rider runs
     */
    startRiderRetry({ trigger }: { trigger: RiderRetryTrigger }): boolean {
        if (!this.visitOpen || this.paused || this.fallback || this.trainerRetry === 'running')
            return false

        const { pairingCase, trainerPhase } = this.getState()
        if (trainerPhase !== 'unavailable')
            return false

        this.retryIndex++
        this.trainerRetry = 'running'
        this.retryCase = pairingCase
        this.retrySawConnecting = false
        this.retryStartFields = this.getRiderRetryStartFields(trigger)

        this.retryTimeoutMs = this.getAttemptTimeoutMs()
        this.retryElapsedMs = 0
        this.retryResumedAt = Date.now()
        this.armRetryTimer()
        return true
    }

    /**
     * Logs the rider's attempt that {@link startRiderRetry} just started, once.
     *
     * @param retryCapabilities the capabilities the attempt covers
     */
    logRiderRetry(retryCapabilities: ReadonlyArray<string>): void {
        if (!this.retryStartFields)
            return
        const fields = { retryCapabilities: retryCapabilities.join(','), ...this.retryStartFields }
        delete this.retryStartFields
        this.safeLog(RIDER_RETRY_EVENT, fields)
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

        const { trainerPhase, trainerRetry } = this.getState()
        const status = getPairingStatusDisplay({
            ...src,
            trainerPhase,
            trainerRetry,
            fallbackActive: this.fallback !== undefined,
            fallbackCapability: this.fallback?.capability,
            fallbackReverted: this.fallbackReverted,
            partialOutageSince: this.partialOutageSince,
            helperThresholdReached: this.visitOpen && this.thresholdReached,
            now: Date.now(),
        })

        if (this.visitOpen) {
            this.lastStatusId = status.id
            if (status.id === 'S1b' && hint)
                this.onPartialOutageShown(src, hint)
            this.observeForHelper(src)
            this.updateHelper()
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
            helperShown: this.helperShown,
            fallbackActive: this.fallback !== undefined,
            trainerRetries: this.retryIndex,
        }
        if (trainerPhase)
            fields.trainerPhase = trainerPhase
        if (this.partialOutageShown) {
            fields.partialOutageInterface = this.partialOutageShown.interface
            fields.partialOutageReason = this.partialOutageShown.reason
        }
        if (this.lastReason)
            fields.lastReason = this.lastReason
        return fields
    }

    /** The helper's current state, with the answers offered for where the trainer stands right now. */
    getHelper(): PairingHelperState {
        const { trainerPhase } = this.getState()
        const reasons = getPairingHelperReasons(trainerPhase)
        const selectedReason = this.selectedReason && reasons.includes(this.selectedReason) ? this.selectedReason : undefined
        return {
            phase: this.helperPhase,
            trainerPhase,
            reasons,
            selectedReason,
            separateSensor: trainerPhase ? this.separateSensor : undefined,
            fallbackCandidate: this.getFallbackCandidate(),
            continueTarget: this.getContinueWithoutDeviceAction().target,
            platform: this.platform,
            forRide: this.forRide,
        }
    }

    /**
     * Opens the helper on the rider's request, also before the threshold and after it was dismissed.
     *
     * @param trigger what the rider used; by default the status line's link, which in the
     * trainer-unavailable phase is its "not available" link
     */
    openHelper(trigger?: PairingHelperTrigger): void {
        if (!this.visitOpen || this.helperPhase === 'open')
            return
        const linkTrigger: PairingHelperTrigger = this.getState().trainerPhase === 'unavailable' ? 'trainer_unavailable_link' : 'link'
        this.showHelper(trigger ?? linkTrigger)
    }

    /** The rider closed the helper: it doesn't open by itself again in this visit. */
    dismissHelper(): void {
        if (this.helperPhase === 'open')
            this.logHelperClosed('dismiss')
        if (this.helperPhase !== 'hidden')
            this.hideHelper()
        if (this.visitOpen)
            this.helperDismissed = true
    }

    /**
     * The rider picked an answer. Only an answer the helper offers right now counts.
     *
     * @param reason the answer
     */
    selectReason(reason: PairingHelperReason): void {
        if (!this.visitOpen || this.helperPhase !== 'open' || !this.getHelper().reasons.includes(reason))
            return
        this.selectedReason = reason
        this.lastReason = reason
        this.reasonSelections++
        this.safeLog(HELPER_REASON_EVENT, this.getHelperEventFields({
            reason,
            selectionIndex: this.reasonSelections,
            elapsedMs: this.getHelperElapsedMs(),
            connectedCapabilities: this.connectedCapabilities,
            interfaceStates: this.interfaceStates,
        }))
    }

    // an answer the rider gave elsewhere on the page, not by tapping it in the helper: picked, but not
    // logged as a selection
    protected preselectReason(reason: PairingHelperReason): void {
        if (!this.getHelper().reasons.includes(reason))
            return
        this.selectedReason = reason
        this.lastReason = reason
    }

    /**
     * A device list opened or closed. While one is open, the helper doesn't open by itself; it does
     * once the list has closed.
     *
     * @param open whether a device list is open
     */
    setDeviceListOpen(open: boolean): void {
        this.deviceListOpen = open
    }

    /** The no-device action as it stands right now: where it goes, its label and its note. */
    getContinueWithoutDeviceAction(): ContinueWithoutDeviceAction {
        // Simulate is offered whenever the page is opened for a ride and the row isn't ready, which
        // is always the case while the helper offers this action
        return getContinueWithoutDeviceAction({ rideMode: this.forRide, canSimulate: this.forRide })
    }

    /**
     * The rider took the no-device action: the helper closes, and the page goes where the action says.
     *
     * @returns which of the page's own actions to run
     */
    continueWithoutDevice(): ContinueWithoutDeviceTarget {
        const { target } = this.getContinueWithoutDeviceAction()
        if (this.visitOpen && this.helperPhase === 'open') {
            const fields: Record<string, unknown> = { action: 'continue_without_device' }
            if (this.selectedReason)
                fields.reason = this.selectedReason
            fields.continueTarget = target
            this.safeLog(HELPER_ACTION_EVENT, this.getHelperEventFields(fields))
            this.logHelperClosed('continue_without_device')
            this.hideHelper()
        }
        return target
    }

    // what the helper needs from the page's state: strings and booleans only, never a device id or name
    protected observeForHelper(src: PairingStatusSource): void {
        const caps = src.capabilities
        const required = REQUIRED_CAPABILITIES.map(name => caps.find(c => c.capability === name))
        this.rowReady = src.canStartRide || src.stillLooking === true
        this.readyCapability = required.find(isConnected)?.capability ?? required.find(isCapabilityActive)?.capability
        this.connectedCapabilities = CAPABILITY_ORDER.filter(name => isConnected(caps.find(c => c.capability === name))).join(',')
        this.interfaceStates = src.interfaces.map(i => `${i.id}:${toInterfaceState(i)}`).join(',')

        const trainerUdid = required[0]?.selected
        const separate = required.slice(1).find(c => isConnected(c) && c?.selected !== trainerUdid)
        this.separateSensor = separate?.capability as 'power' | 'speed' | undefined
    }

    protected updateHelper(): void {
        if (this.helperPhase === 'open' && this.rowReady) {
            this.resolveHelper()
            return
        }
        this.openHelperIfDue()
    }

    // opens by itself once per visit: after the threshold and, with a trainer configured, once its
    // attempt has an outcome, so it never offers help while the trainer may still connect
    protected openHelperIfDue(): boolean {
        if (!this.canOpenHelperByItself())
            return false
        this.helperAutoOpened = true
        this.showHelper('timer')
        return true
    }

    protected canOpenHelperByItself(): boolean {
        if (!this.visitOpen || this.paused || !this.thresholdReached)
            return false
        if (this.helperAutoOpened || this.helperDismissed || this.helperPhase !== 'hidden')
            return false
        if (this.rowReady || this.deviceListOpen || this.lastStatusId === 'S8')
            return false
        return this.getState().trainerPhase !== 'connecting'
    }

    protected showHelper(trigger: PairingHelperTrigger): void {
        this.clearHelperResolvedTimer()
        this.helperPhase = 'open'
        this.helperShownAt = Date.now()
        this.helperShown = true
        delete this.selectedReason

        this.safeLog(HELPER_SHOWN_EVENT, this.getHelperEventFields({
            trigger,
            elapsedMs: this.getHelperElapsedMs(),
            thresholdMs: this.getHelperThresholdMs(),
            platform: this.platform,
            forRide: this.forRide,
            connectedCapabilities: this.connectedCapabilities,
            interfaceStates: this.interfaceStates,
        }))
    }

    protected resolveHelper(): void {
        const fields: Record<string, unknown> = { msSinceShown: this.getMsSinceShown() }
        if (this.lastReason)
            fields.lastReason = this.lastReason
        if (this.readyCapability)
            fields.capability = this.readyCapability
        this.safeLog(HELPER_RESOLVED_EVENT, this.getHelperEventFields(fields))

        this.helperPhase = 'resolved'
        this.clearHelperResolvedTimer()
        this.helperResolvedTimer = setTimeout(() => { this.onHelperResolvedShown() }, HELPER_RESOLVED_DISPLAY_MS)
    }

    protected onHelperResolvedShown(): void {
        delete this.helperResolvedTimer
        try {
            this.hideHelper()
            this.deps.onChange()
        }
        catch {
            // a failing page update must not leave the timer callback throwing
        }
    }

    protected hideHelper(): void {
        this.clearHelperResolvedTimer()
        this.helperPhase = 'hidden'
        delete this.helperShownAt
        delete this.selectedReason
    }

    protected logHelperClosed(via: PairingHelperCloseVia): void {
        const fields: Record<string, unknown> = { via, msSinceShown: this.getMsSinceShown() }
        if (this.lastReason)
            fields.lastReason = this.lastReason
        this.safeLog(HELPER_CLOSED_EVENT, this.getHelperEventFields(fields))
    }

    // every helper event carries the visit and where the trainer stands; strings, numbers and booleans only
    protected getHelperEventFields(fields: Record<string, unknown>): Record<string, unknown> {
        const { pairingCase, trainerPhase, trainerConfigured } = this.getState()
        const all: Record<string, unknown> = {}
        if (this.visitId !== undefined)
            all.visitId = this.visitId
        Object.assign(all, fields)
        all.pairingCase = pairingCase
        if (trainerPhase)
            all.trainerPhase = trainerPhase
        all.trainerConfigured = trainerConfigured
        return all
    }

    protected getMsSinceShown(): number {
        return this.helperShownAt === undefined ? 0 : Date.now() - this.helperShownAt
    }

    protected getHelperThresholdMs(): number {
        return HELPER_THRESHOLD_MS[this.platform] ?? HELPER_THRESHOLD_MS.desktop
    }

    protected getHelperElapsedMs(): number {
        const running = this.helperResumedAt === undefined ? 0 : Date.now() - this.helperResumedAt
        return this.helperElapsedMs + running
    }

    protected stopHelperClock(): void {
        this.helperElapsedMs = this.getHelperElapsedMs()
        delete this.helperResumedAt
    }

    protected armHelperTimer(): void {
        this.clearHelperTimer()
        if (!this.visitOpen || this.paused || this.thresholdReached)
            return
        const remaining = Math.max(0, this.getHelperThresholdMs() - this.getHelperElapsedMs())
        this.helperTimer = setTimeout(() => { this.onHelperThreshold() }, remaining)
    }

    protected clearHelperTimer(): void {
        if (this.helperTimer)
            clearTimeout(this.helperTimer)
        delete this.helperTimer
    }

    protected clearHelperResolvedTimer(): void {
        if (this.helperResolvedTimer)
            clearTimeout(this.helperResolvedTimer)
        delete this.helperResolvedTimer
    }

    protected onHelperThreshold(): void {
        delete this.helperTimer
        try {
            this.thresholdReached = true
            this.openHelperIfDue()
            // the status line moves on to "still searching" either way
            this.deps.onChange()
        }
        catch {
            // a failing page update must not leave the timer callback throwing
        }
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

    protected followTrainer(state: PairingState): void {
        const control = state?.capabilities?.find(c => c.capability === IncyclistCapability.Control)
        this.trainerConfigured = isCapabilityActive(control)
        if (this.fallback && !this.isOnFallback(control))
            delete this.fallback

        if (!this.trainerConfigured) {
            // on the fallback, the trainer is excluded but keeps its phase: the page still waits for it
            if (!this.fallback)
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

    // the trainer the fallback replaces is still selected, and still excluded as not available
    protected isOnFallback(control: CapabilityData | undefined): boolean {
        return control?.selected === this.fallback?.trainerUdid && control?.excluded?.reason === NOT_AVAILABLE.reason && !control?.disabled
    }

    protected closeHelperForFallback(capability: PairingFallbackCapability): void {
        if (this.helperPhase !== 'open') {
            this.hideHelper()
            return
        }
        const fields: Record<string, unknown> = { action: 'fallback_without_trainer' }
        if (this.selectedReason)
            fields.reason = this.selectedReason
        fields.fallbackCapability = capability
        this.safeLog(HELPER_ACTION_EVENT, this.getHelperEventFields(fields))
        this.logHelperClosed('fallback')
        this.hideHelper()
    }

    protected onFallbackRevertedShown(): void {
        delete this.fallbackRevertedTimer
        try {
            this.fallbackReverted = false
            this.deps.onChange()
        }
        catch {
            // a failing page update must not leave the timer callback throwing
        }
    }

    protected clearFallbackRevertedTimer(): void {
        if (this.fallbackRevertedTimer)
            clearTimeout(this.fallbackRevertedTimer)
        delete this.fallbackRevertedTimer
    }

    // ends the rider's attempt once it has an outcome; see startRiderRetry()
    protected followRiderRetry(previousConnectState: string | undefined): void {
        if (this.trainerRetry !== 'running')
            return

        if (this.phase === 'connected') {
            this.endRiderRetry('connected')
            return
        }

        const connectState = this.lastConnectState
        if (connectState === 'connecting' && previousConnectState !== 'connecting')
            this.retrySawConnecting = true
        else if (connectState === 'failed' && previousConnectState !== 'failed' && this.retrySawConnecting)
            this.endRiderRetry('failed')
    }

    protected endRiderRetry(retryResult: RiderRetryResult): void {
        const durationMs = this.getRetryElapsedMs()
        const lasting = retryResult === 'failed' || retryResult === 'timeout'
        this.clearRiderRetry()
        if (lasting)
            this.trainerRetry = 'failed'

        // strings, numbers and booleans only, never a device id or name
        this.safeLog(RIDER_RETRY_ENDED_EVENT, {
            retryResult,
            durationMs,
            retryIndex: this.retryIndex,
            pairingCase: this.retryCase,
            platform: this.platform,
        })
    }

    // the attempt and its timer go, without an outcome
    protected clearRiderRetry(): void {
        this.clearRetryTimer()
        delete this.trainerRetry
        delete this.retryTimeoutMs
        delete this.retryResumedAt
        delete this.retryStartFields
        this.retryElapsedMs = 0
        this.retrySawConnecting = false
    }

    // what the page showed at the tap; strings, numbers and booleans only, never a device id or name
    protected getRiderRetryStartFields(trigger: RiderRetryTrigger): Record<string, unknown> {
        const fields: Record<string, unknown> = { trigger, retryIndex: this.retryIndex }
        if (this.unavailableSince !== undefined)
            fields.msSinceUnavailable = Date.now() - this.unavailableSince
        fields.separateDeviceConnected = this.separateSensor !== undefined
        fields.helperOpen = this.helperPhase === 'open'
        fields.pairingCase = this.retryCase
        fields.platform = this.platform
        return fields
    }

    protected getRetryElapsedMs(): number {
        const running = this.retryResumedAt === undefined ? 0 : Date.now() - this.retryResumedAt
        return this.retryElapsedMs + running
    }

    protected stopRetryClock(): void {
        this.retryElapsedMs = this.getRetryElapsedMs()
        delete this.retryResumedAt
    }

    protected armRetryTimer(): void {
        this.clearRetryTimer()
        if (this.paused || this.trainerRetry !== 'running' || this.retryTimeoutMs === undefined)
            return
        const remaining = Math.max(0, this.retryTimeoutMs - this.getRetryElapsedMs())
        this.retryTimer = setTimeout(() => { this.onRetryTimeout() }, remaining)
    }

    protected clearRetryTimer(): void {
        if (this.retryTimer)
            clearTimeout(this.retryTimer)
        delete this.retryTimer
    }

    protected onRetryTimeout(): void {
        delete this.retryTimer
        try {
            if (this.trainerRetry !== 'running')
                return
            this.endRiderRetry('timeout')
            this.deps.onChange()
        }
        catch {
            // a failing page update must not leave the timer callback throwing
        }
    }

    protected startTrainer(control: CapabilityData): void {
        this.stopAttempt()
        this.clearRiderRetry()
        delete this.unavailableSince
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
        // the attempt was about this trainer: with the trainer gone, it has nothing left to follow
        this.clearRiderRetry()
        delete this.unavailableSince
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
        if (toPhase === 'unavailable')
            this.unavailableSince = Date.now()
        else
            delete this.unavailableSince
        // a connected trainer ends whatever a failed attempt of the rider said
        if (toPhase === 'connected' && this.trainerRetry === 'failed')
            this.clearRiderRetry()

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
        this.retryIndex = 0
        delete this.retryCase
        delete this.fallback
        this.fallbackReverted = false
        this.clearFallbackRevertedTimer()
        this.clearPartialOutage()
        this.resetHelper()
        this.visitOpen = false
        this.paused = false
        this.trainerConfigured = false
        delete this.visitId
        delete this.partialOutageShown
        delete this.lastStatusId
    }

    protected resetHelper(): void {
        this.clearHelperTimer()
        this.hideHelper()
        this.helperElapsedMs = 0
        delete this.helperResumedAt
        this.thresholdReached = false
        this.helperShown = false
        this.helperAutoOpened = false
        this.helperDismissed = false
        this.deviceListOpen = false
        delete this.lastReason
        this.reasonSelections = 0
        this.rowReady = false
        delete this.readyCapability
        this.connectedCapabilities = ''
        this.interfaceStates = ''
        delete this.separateSensor
        this.platform = 'desktop'
        this.forRide = false
    }
}
