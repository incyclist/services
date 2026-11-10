import type { IncyclistCapability } from 'incyclist-devices'
import type { PairingPlatform, PairingStatusTrainerPhase, PairingTrainerRetry } from '../../../pairing/guidance'
import type { ContinueWithoutDeviceTarget, PairingHelperReason } from '../../../pairing/helper'
import type { CapabilityExclusion, ExclusionOptions } from '../../../configuration/model/exclusion'

/** What started the rider's own connection attempt: a tap on the tile that takes the trainer back into use. */
export type RiderRetryTrigger = 'tile'

/** How the rider's own connection attempt ended, as logged. */
export type RiderRetryResult = 'connected' | 'failed' | 'timeout' | 'left_page'

/** What the ride falls back to while the trainer isn't available. */
export type PairingFallbackCapability = 'power' | 'speed'

/**
 * Where the configured trainer is in its connection attempt during a Pairing page visit.
 * `unavailable` means the attempt has failed or timed out (or the rider said the trainer isn't
 * available). It stays that way through later retries until the trainer actually connects.
 */
export type TrainerPhase = PairingStatusTrainerPhase

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
    /** the attempt the rider started: `running`, or `failed` once it failed or timed out. Not set otherwise. */
    trainerRetry?: PairingTrainerRetry
    /** set while the ride falls back to another device because the trainer isn't available */
    fallback?: { capability: PairingFallbackCapability }
}

/** Why an interface counts as a partial outage, as logged. */
export type PartialOutageReason = 'permission' | 'off' | 'not-found' | 'unknown'

/** The interface and reason of a first-use partial outage, as logged. */
export interface PartialOutage {
    interface: string
    reason: PartialOutageReason
}

/** What the guidance adds to the `pairing page left` event. Strings are omitted when there's nothing to say. */
export interface PairingGuidanceExitFields {
    pairingCase: PairingCase
    trainerPhase?: TrainerPhase
    partialOutageShown: boolean
    partialOutageInterface?: string
    partialOutageReason?: PartialOutageReason
    /** every required capability was switched off when the rider left */
    switchedOffRequired: boolean
    /** the helper was shown at least once in this visit */
    helperShown: boolean
    /** the last answer the rider picked in the helper, if any */
    lastReason?: PairingHelperReason
    /** the ride falls back to another device because the trainer isn't available */
    fallbackActive: boolean
    /** how many connection attempts the rider started in this visit */
    trainerRetries: number
}

/** What a visit needs to know when it starts. */
export interface PairingGuidanceVisitProps {
    /** the id the visit tracker gave this visit, for the events of this visit */
    visitId?: string
    /** which platform's helper threshold applies; desktop's when not given */
    platform?: PairingPlatform
    /** the page was opened for a ride */
    forRide?: boolean
}

/**
 * Where the helper is in this visit: `hidden`, `open`, or `resolved` (a device made the row ready
 * while it was open; it says so for a moment, then hides).
 */
export type PairingHelperPhase = 'hidden' | 'open' | 'resolved'

/** What opened the helper. */
export type PairingHelperTrigger = 'timer' | 'link' | 'trainer_unavailable_link' | 'tile_unselect'

/** How the helper was closed, other than by a device making the row ready. */
export type PairingHelperCloseVia = 'dismiss' | 'continue_without_device' | 'fallback' | 'page_left'

/** The helper's current state. */
export interface PairingHelperState {
    phase: PairingHelperPhase
    /** where the configured trainer's attempt stands; not set without a trainer */
    trainerPhase?: TrainerPhase
    /** the answers offered right now, in display order */
    reasons: PairingHelperReason[]
    /** the picked answer, if it is still one of `reasons` */
    selectedReason?: PairingHelperReason
    /** a power meter or speed sensor other than the trainer is connected */
    separateSensor?: 'power' | 'speed'
    /** what the ride could fall back to right now, if the rider chooses to ride without the trainer */
    fallbackCandidate?: PairingFallbackCapability
    /** what the no-device action does right now */
    continueTarget: ContinueWithoutDeviceTarget
    platform: PairingPlatform
    forRide: boolean
}

/** The part of the device configuration the guidance needs to let the ride fall back to another device. */
export interface PairingGuidanceConfiguration {
    excludeDevice(udid: string, opts: ExclusionOptions): void
    includeCapability(capability: IncyclistCapability): void
    getExclusions(): CapabilityExclusion[]
}

export interface PairingGuidanceDeps {
    /** writes one analytics event */
    log: (message: string, fields: Record<string, unknown>) => void
    /** called whenever the guidance state changed on its own, e.g. when a timer expired */
    onChange: () => void
    /** the device configuration, for the fallback; without it, no fallback can be chosen */
    configuration?: () => PairingGuidanceConfiguration
}
