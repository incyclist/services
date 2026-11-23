import { KNOWN_DEVICE_NAMES } from './known-device-names'

// a purely numeric part, or one that only consists of hex digits and contains a digit, is part of a serial number
const isDeviceId = (part: string): boolean => /^[0-9]+$/.test(part) || (/^[0-9a-f]+$/.test(part) && /[0-9]/.test(part))

// "assiomapro09885l" -> "assiomapro", "d2ride2121" -> "d2ride": everything from a run of 4+ digits on is a serial number
const cutSerialNumber = (part: string): string => part.replace(/[0-9]{4,}.*$/, '')

/**
 * Splits a device name into lower case parts. Per-device suffixes (serial numbers, MAC fragments such as "4d13",
 * "c4d1", "30485") are dropped, as are parts shorter than 3 characters.
 *
 * "VANRYSEL-HT-c4d1" -> ['vanrysel']; "Tacx Flux-2 30485" -> ['tacx', 'flux']; "H6M 58398" -> ['h6m']
 */
export const getNameParts = (name?: string): string[] => {
    if (!name || typeof name !== 'string')
        return []

    return name
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map(cutSerialNumber)
        .filter(part => part.length >= 3 && !isDeviceId(part))
}

/**
 * An entry matches a part if it is equal to it. An entry that ends with `*` stands for a whole family and matches
 * every part that starts with it: "hrm*" matches "hrm", "hrm200" and "hrmpro".
 */
export const matchesNamePart = (entry: string, part: string): boolean =>
    entry.endsWith('*') ? part.startsWith(entry.slice(0, -1)) : part === entry

/**
 * Whether the name of a device contains one of the known parts.
 *
 * The consumer that keeps the block list (the desktop app) has its own copy of this logic: it runs in a process that
 * does not load this library. Both copies are covered by the same test cases.
 *
 * @param name     the advertised name of the device
 * @param entries  the list to look in (default: the list of this library)
 */
export const isKnownDeviceName = (name?: string, entries: string[] = KNOWN_DEVICE_NAMES.names): boolean => {
    const parts = getNameParts(name)
    return parts.some(part => entries.some(entry => matchesNamePart(entry, part)))
}
