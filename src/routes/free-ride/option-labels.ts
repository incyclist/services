import { FreeRideManeuver } from "../list/types"

/**
 * Pure helpers that turn the raw continuation data of a junction (angle, way tags) into what a rider
 * reads on an option button: turn word, road label and a left-to-right order.
 *
 * Angles are relative to the current heading, in degrees. Positive means "to the right".
 */

export const MANEUVER_TEXT: Record<FreeRideManeuver, string> = {
    'straight': 'Straight',
    'slight-left': 'Slight left',
    'slight-right': 'Slight right',
    'left': 'Left',
    'right': 'Right',
    'sharp-left': 'Sharp left',
    'sharp-right': 'Sharp right',
    'keep-left': 'Keep left',
    'keep-right': 'Keep right',
    'u-turn': 'Turn around',
    'roundabout': 'Roundabout',
    'unknown': 'Road'
}

const COMPASS_WORDS = ['North', 'Northeast', 'East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest']

export const FALLBACK_LABEL = {
    roundabout: 'Roundabout',
    slip: 'Slip road',
    unnamed: 'Unnamed road'
}

export type OptionLabelInput = {
    id: string
    direction?: number
    roundabout?: boolean
    compass?: string
    tags?: Record<string, string>
}

export type OptionLabel = {
    maneuver: FreeRideManeuver
    maneuverText: string
    roadName?: string
    roadLabel: string
    compass?: string
    degraded: boolean
}

/**
 * Normalizes an angle to the range (-180, 180]
 */
export const normalizeAngle = (angle: number): number => {
    if (!Number.isFinite(angle))
        return angle

    let a = angle % 360
    if (a > 180) a -= 360
    if (a <= -180) a += 360
    return a
}

export const getCompassWord = (heading: number): string | undefined => {
    if (!Number.isFinite(heading))
        return undefined

    const normalized = ((heading % 360) + 360) % 360
    return COMPASS_WORDS[Math.round(normalized / 45) % 8]
}

const bucket = (angle: number): FreeRideManeuver => {
    const abs = Math.abs(angle)
    const right = angle > 0

    if (abs <= 20) return 'straight'
    if (abs <= 60) return right ? 'slight-right' : 'slight-left'
    if (abs <= 135) return right ? 'right' : 'left'
    if (abs <= 170) return right ? 'sharp-right' : 'sharp-left'
    return 'u-turn'
}

/**
 * Derives the turn word of every option of a junction.
 *
 * If several options fall into the same bucket, they are told apart as keep-left / keep-right (ordered by angle).
 * Roundabout options are always 'roundabout', because the entry angle of a ring says nothing about the exit.
 * Options without a valid angle are 'unknown'.
 */
export const deriveManeuvers = (options: Array<Pick<OptionLabelInput, 'direction' | 'roundabout'>>): FreeRideManeuver[] => {

    const result: FreeRideManeuver[] = options.map(o => {
        if (o.roundabout) return 'roundabout'
        if (!Number.isFinite(o.direction)) return 'unknown'
        return bucket(o.direction as number)
    })

    const groups = new Map<FreeRideManeuver, number[]>()
    result.forEach((m, idx) => {
        if (m === 'roundabout' || m === 'unknown' || m === 'u-turn') return
        groups.set(m, [...(groups.get(m) ?? []), idx])
    })

    groups.forEach(indexes => {
        if (indexes.length < 2) return

        const sorted = [...indexes].sort((a, b) => (options[a].direction as number) - (options[b].direction as number))
        result[sorted[0]] = 'keep-left'
        result[sorted.at(-1) as number] = 'keep-right'
    })

    return result
}

/**
 * Builds the road name and a display label that is never empty
 */
export const getRoadLabel = (tags?: Record<string, string>): { roadName?: string, roadLabel: string } => {
    const roadName = tags?.name || tags?.ref || undefined
    if (roadName)
        return { roadName, roadLabel: roadName }

    if (tags?.junction === 'roundabout')
        return { roadLabel: FALLBACK_LABEL.roundabout }

    if (tags?.highway?.endsWith('_link'))
        return { roadLabel: FALLBACK_LABEL.slip }

    return { roadLabel: FALLBACK_LABEL.unnamed }
}

const FORK_SIDES: Record<number, string[]> = {
    2: ['left fork', 'right fork'],
    3: ['left fork', 'middle fork', 'right fork']
}

/**
 * Creates the labels of all options of a junction and makes sure that no two options read the same.
 *
 * Steps, stopping as soon as every option (turn word + road label) is unique:
 * 1. the turn word (already part of deriveManeuvers)
 * 2. append the compass word
 * 3. append the side of the fork (compared between the colliding options only)
 * 4. a degraded option reads "Road n"
 */
export const buildOptionLabels = (options: OptionLabelInput[]): OptionLabel[] => {
    const maneuvers = deriveManeuvers(options)

    const labels: OptionLabel[] = options.map((o, idx) => {
        const maneuver = maneuvers[idx]
        const degraded = maneuver === 'unknown'
        const { roadName, roadLabel } = getRoadLabel(o.tags)

        return {
            maneuver,
            maneuverText: degraded ? (o.compass ? `Heading ${o.compass.toLowerCase()}` : `Road ${idx + 1}`) : MANEUVER_TEXT[maneuver],
            roadName,
            roadLabel,
            compass: o.compass,
            degraded
        }
    })

    const key = (l: OptionLabel) => `${l.maneuverText}|${l.roadLabel}`
    const collisions = () => {
        const groups = new Map<string, number[]>()
        labels.forEach((l, idx) => groups.set(key(l), [...(groups.get(key(l)) ?? []), idx]))
        return [...groups.values()].filter(g => g.length > 1)
    }

    // step 2: compass word
    collisions().forEach(group => {
        const compasses = group.map(idx => labels[idx].compass)
        if (compasses.some(c => !c) || new Set(compasses).size !== group.length)
            return
        group.forEach(idx => { labels[idx].roadLabel = `${labels[idx].roadLabel}, ${labels[idx].compass?.toLowerCase()}` })
    })

    // step 3: side of the fork
    collisions().forEach(group => {
        const sides = FORK_SIDES[group.length]
        if (!sides || group.some(idx => !Number.isFinite(options[idx].direction)))
            return

        const sorted = [...group].sort((a, b) => (options[a].direction as number) - (options[b].direction as number))
        sorted.forEach((idx, i) => { labels[idx].roadLabel = `${labels[idx].roadLabel}, ${sides[i]}` })
    })

    return labels
}

/**
 * Returns the order in which the options are shown (and numbered): left to right as the roads leave the junction.
 * Options without a valid angle come last, roundabout exits keep the given order.
 *
 * @returns the indexes into the given array
 */
export const getLayoutOrder = (options: Array<Pick<OptionLabelInput, 'direction' | 'roundabout'>>): number[] => {
    const indexes = options.map((_o, idx) => idx)

    if (options.some(o => o.roundabout))
        return indexes

    const valid = (idx: number) => Number.isFinite(options[idx].direction)
    const withAngle = indexes.filter(valid).sort((a, b) => (options[a].direction as number) - (options[b].direction as number))
    const withoutAngle = indexes.filter(idx => !valid(idx))

    return [...withAngle, ...withoutAngle]
}
