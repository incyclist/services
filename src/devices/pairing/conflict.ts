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

    const short = 'Nothing changes until you choose.'
    const full = names.length > 0
        ? `${freed} it. Choose for the rest; nothing changes until you do.`
        : short
    return { full, short }
}

/** The label of the choice that keeps the current device in a slot. */
export const getConflictKeepLabel = (currentName: string): string => `Keep ${currentName}`

/** The label of the choice that gives a slot to the new device. */
export const getConflictReplaceLabel = (deviceName: string): string => `Use ${deviceName}`

/**
 * What the conflict card's header says about the conflicts waiting behind it.
 *
 * @param queued how many conflicts wait behind the one shown
 * @returns e.g. "1 more", or `undefined` when none waits
 */
export const getConflictQueuedText = (queued: number): string | undefined => queued > 0 ? `${queued} more` : undefined
