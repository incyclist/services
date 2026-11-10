import type { SelectionConflict } from './model'

const CAPABILITY_TITLES: Readonly<Record<string, string>> = {
    control: 'Resistance',
    power: 'Power',
    speed: 'Speed',
    cadence: 'Cadence',
    heartrate: 'Heartrate',
    app_control: 'Controller',
}

const joinNames = (names: string[]): string => {
    if (names.length <= 1) return names.join('')
    return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/**
 * A capability's tile title, as the conflict step names it.
 *
 * @param capability the capability
 */
export const getCapabilityTitle = (capability: string): string => CAPABILITY_TITLES[capability] ?? capability

/**
 * The conflict step's title.
 *
 * @param deviceName the device that would take the slots
 */
export const getConflictStepTitle = (deviceName: string): string => `${deviceName} can also measure more`

/**
 * The line under the conflict step's title, in both variants (`short` is the phone copy). It says
 * which free slots the device fills, and that nothing changes until the rider chooses.
 *
 * @param origin whether the device was found by a search (the card) or picked in a device list (the list's second step)
 * @param deviceName the device that would take the slots
 * @param filled the free slots it fills
 */
export const getConflictStepSubline = (origin: SelectionConflict['origin'], deviceName: string, filled: ReadonlyArray<string>): { full: string, short: string } => {
    const names = filled.map(getCapabilityTitle)
    const freed = names.length > 1 ? `${joinNames(names)} were free and now use` : `${joinNames(names)} was free and now uses`

    if (origin === 'manual') {
        const full = names.length > 0
            ? `Choose which device to use for each. ${freed} ${deviceName}.`
            : 'Choose which device to use for each.'
        return { full, short: 'Choose which device to use for each.' }
    }

    // the rider didn't ask for this one, so it says why it appeared. The filled-slots line follows
    // on the full copy only - on phone those tiles already show the device, so it's dropped there.
    const short = `Just found ${deviceName}. Nothing changes until you choose.`
    const full = names.length > 0
        ? `We just found your ${deviceName}. Nothing changes until you choose. ${freed} ${deviceName}.`
        : `We just found your ${deviceName}. Nothing changes until you choose.`
    return { full, short }
}

/** The label of the choice that keeps the current device in a slot. */
export const getConflictKeepLabel = (currentName: string): string => `Keep ${currentName}`

/** The label of the choice that gives a slot to the new device. */
export const getConflictReplaceLabel = (deviceName: string): string => `Use ${deviceName}`

/**
 * What to say in the dialog's footer about the conflicts waiting behind the one shown, next to Done -
 * not "{n} more" on its own, which under a title ending "...can also measure more" reads as "can
 * measure {n} more things", not "{n} more questions are waiting".
 *
 * @param queued how many conflicts wait behind the one shown
 * @returns e.g. {full: "2 more devices to check", short: "2 more to check"}, or `undefined` when none waits
 */
export const getConflictQueuedText = (queued: number): { full: string, short: string } | undefined => {
    if (queued<=0)
        return undefined
    const device = queued===1 ? 'device' : 'devices'
    return { full: `${queued} more ${device} to check`, short: `${queued} more to check` }
}
