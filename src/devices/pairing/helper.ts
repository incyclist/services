import type { PairingPlatform, PairingStatusTrainerPhase } from './guidance'

/** The answers the Pairing page helper offers. */
export type PairingHelperReason = 'asleep' | 'other_app' | 'interface' | 'no_device' | 'trainer_unavailable' | 'unsure'

/** Where the no-device action takes the rider today. */
export type ContinueWithoutDeviceTarget = 'simulate' | 'skip' | 'cancel'

export interface ContinueWithoutDeviceAction {
    target: ContinueWithoutDeviceTarget
    label: string
    /** a line shown above the button, when the action doesn't start a ride */
    note?: string
}

export interface PairingHelperTipText {
    text: string
    shortText: string
}

export interface PairingHelperTextParams {
    platform: PairingPlatform
    /** a power meter or speed sensor other than the trainer is connected */
    separateSensor?: 'power' | 'speed'
}

// the most common and most fixable causes first, the "no device / not available" answer second to
// last, the catch-all last
const COMMON_REASONS: ReadonlyArray<PairingHelperReason> = ['asleep', 'other_app', 'interface']

/**
 * The answers the helper offers for where the configured trainer stands. Without a trainer, the rider
 * may not own a device to ride with; with one, that answer would be false. "My trainer isn't
 * available today" only once its attempt has failed or timed out.
 *
 * @param trainerPhase where the configured trainer's attempt stands; `undefined` without a trainer
 * @returns the answers in display order
 */
export const getPairingHelperReasons = (trainerPhase: PairingStatusTrainerPhase | undefined): PairingHelperReason[] => {
    if (trainerPhase === undefined)
        return [...COMMON_REASONS, 'no_device', 'unsure']
    if (trainerPhase === 'unavailable')
        return [...COMMON_REASONS, 'trainer_unavailable', 'unsure']
    return [...COMMON_REASONS, 'unsure']
}

/**
 * The no-device action, labelled for what it does today: Simulate where it's offered, otherwise
 * back to the content pages (Skip) or, when pairing for a ride, back to where the rider came from (Cancel).
 *
 * @param props `rideMode`: the page was opened for a ride; `canSimulate`: Simulate is offered
 * @returns the action's target, label and note
 */
export const getContinueWithoutDeviceAction = ({ rideMode, canSimulate }: { rideMode: boolean, canSimulate: boolean }): ContinueWithoutDeviceAction => {
    const note = "You'll need one of these devices to start a ride."
    if (canSimulate)
        return { target: 'simulate', label: 'Ride with simulated power' }
    if (rideMode)
        return { target: 'cancel', label: 'Go back for now', note }
    return { target: 'skip', label: 'Browse routes for now', note }
}

/**
 * Whether an answer's tip comes with the no-device action: "I don't have a device", and "my trainer
 * isn't available today" while no other power meter or speed sensor is connected.
 *
 * @param reason the picked answer
 * @param separateSensor a power meter or speed sensor other than the trainer is connected
 */
export const hasContinueWithoutDeviceAction = (reason: PairingHelperReason | undefined, separateSensor?: 'power' | 'speed'): boolean =>
    reason === 'no_device' || (reason === 'trainer_unavailable' && separateSensor === undefined)

const SENSOR_LABELS: Record<'power' | 'speed', string> = { power: 'power meter', speed: 'speed sensor' }

/**
 * The helper's title.
 *
 * @param trainerConfigured a trainer is configured: it is known, it just can't be reached
 */
export const getPairingHelperTitle = (trainerConfigured: boolean): string =>
    trainerConfigured ? "Can't connect to your trainer?" : "Can't find your trainer?"

/** The line under the title, shown until an answer is picked. */
export const PAIRING_HELPER_SUBLINE = "Pick what fits best and we'll show you what to try."

/** What the helper says once a device made the row ready. */
export const PAIRING_HELPER_RESOLVED_TEXT = 'Found it! Ready to ride.'

/**
 * The line at the bottom of the helper (not shown on phones).
 *
 * @param trainerConfigured a trainer is configured
 */
export const getPairingHelperFooter = (trainerConfigured: boolean): string =>
    trainerConfigured
        ? 'Still trying to connect to your saved devices.'
        : 'Still searching. Your tiles light up as soon as something is found.'

/**
 * An answer's label.
 *
 * @param reason the answer
 * @param platform which platform's wording applies
 */
export const getPairingHelperReasonLabel = (reason: PairingHelperReason, platform: PairingPlatform): string => {
    switch (reason) {
        case 'asleep': return "It's switched off or asleep"
        case 'other_app': return "It's connected to another app or device"
        case 'interface': return platform === 'mobile' ? "Bluetooth isn't working" : "Bluetooth or ANT+ isn't working"
        case 'no_device': return "I don't have a trainer, power meter or speed sensor"
        case 'trainer_unavailable': return "My trainer isn't available today"
        case 'unsure': return 'Something else / not sure'
    }
}

const getOtherAppTip = (platform: PairingPlatform): PairingHelperTipText => ({
    text: platform === 'mobile'
        ? 'A trainer usually talks to only one app at a time. Close Zwift or other training apps, and disconnect it from your bike computer or another phone or tablet.'
        : 'A trainer usually talks to only one app at a time. Close Zwift or other training apps, and disconnect it from your bike computer.',
    shortText: 'Close other training apps and disconnect it from your bike computer.',
})

const getInterfaceTip = (platform: PairingPlatform): PairingHelperTipText => ({
    text: platform === 'mobile'
        ? 'Make sure Bluetooth is on and Incyclist is allowed to use it. The Bluetooth icon at the top right shows its status. If your trainer connects over Wi-Fi, turn Wi-Fi on too.'
        : "Check the connection icons at the bottom left. Grey or red means that connection isn't available. ANT+ stick not found? If you use one, plug it in, try another USB port, or close other apps that use it.",
    shortText: 'Make sure Bluetooth is on and allowed (icon at the top right).',
})

const getTrainerUnavailableTip = (separateSensor: 'power' | 'speed' | undefined): PairingHelperTipText => {
    if (separateSensor === undefined)
        return {
            text: 'To ride without your trainer, Incyclist needs a power meter or speed sensor, and none is connected. Have one? Tap the Power or Speed tile to add it.',
            shortText: 'No power meter or speed sensor connected. Have one? Tap Power or Speed to add it.',
        }
    const sensor = SENSOR_LABELS[separateSensor]
    return {
        text: `You can ride with your ${sensor} instead. Normally Incyclist changes your trainer's resistance, so you feel hills and workouts get harder or easier by themselves. With only a ${sensor} that doesn't happen: you set the effort with your gears. This lasts until you next open Devices.`,
        shortText: `Ride with your ${sensor} instead. You won't feel hills or workout changes; use your gears. Until you next open Devices.`,
    }
}

/**
 * An answer's tip, in both variants (`shortText` is the phone copy).
 *
 * @param reason the answer
 * @param params the platform, and for "my trainer isn't available today" whether another sensor is connected
 */
export const getPairingHelperTip = (reason: PairingHelperReason, params: PairingHelperTextParams): PairingHelperTipText => {
    switch (reason) {
        case 'asleep':
            return {
                text: 'Most trainers and sensors go to sleep when idle. Pedal a few strokes or press a button on the device. We keep trying automatically.',
                shortText: 'Pedal a few strokes or press a button on it. We keep trying.',
            }
        case 'other_app':
            return getOtherAppTip(params.platform)
        case 'interface':
            return getInterfaceTip(params.platform)
        case 'no_device':
            return {
                text: "To ride, Incyclist needs a smart trainer, a power meter or a speed sensor. A heart-rate monitor or cadence sensor alone isn't enough.",
                shortText: 'Riding needs a smart trainer, power meter or speed sensor.',
            }
        case 'trainer_unavailable':
            return getTrainerUnavailableTip(params.separateSensor)
        case 'unsure': {
            const device = params.platform === 'mobile' ? 'phone' : 'computer'
            return {
                text: `Two quick things to try: unplug your trainer's power for 10 seconds and plug it back in, and move your ${device} closer to it (for ANT+, a USB extension cable helps). We keep trying automatically.`,
                shortText: 'Unplug the trainer for 10 s, then move your phone closer.',
            }
        }
    }
}
