import { IncyclistCapability } from 'incyclist-devices'

import { isCapabilityActive } from '../../../pairing/capability'
import { PARTIAL_OUTAGE_DEBOUNCE_MS } from '../../../pairing/guidance'
import { getPairingStatusDisplay, getPartialOutageHint } from '../../../pairing/status'
import { getContinueWithoutDeviceAction, getPairingHelperReasons } from '../../../pairing/helper'
import type { CapabilityData, PairingState } from '../../../pairing/model'
import type { PairingHint, PairingInterfaceId, PairingInterfaceState, PairingPlatform, PairingStatusId } from '../../../pairing/guidance'
import type { PairingStatusCapability, PairingStatusDisplayProps, PairingStatusSource } from '../../../pairing/status'
import type { ContinueWithoutDeviceAction, ContinueWithoutDeviceTarget, PairingHelperReason } from '../../../pairing/helper'
import type {
    PairingCase, PairingGuidanceDeps, PairingGuidanceExitFields, PairingGuidanceState, PairingGuidanceVisitProps, PairingHelperCloseVia,
    PairingHelperPhase, PairingHelperState, PairingHelperTrigger, PartialOutage, TrainerPhase, TrainerPhaseCause
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
        this.reset()
    }

    /** The app went to the background: the timers stop, and pairing states are ignored. */
    pauseVisit(): void {
        if (!this.visitOpen || this.paused)
            return
        this.paused = true
        this.stopAttemptClock()
        this.clearAttemptTimer()
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
