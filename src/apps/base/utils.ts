// timestamps below this value are interpreted as epoch seconds, otherwise as epoch milliseconds
// (1e11 ms is in 1973, 1e11 s is in the year 5138)
const MAX_EPOCH_SECONDS = 1e11

/**
 * Converts the expiration of an access token, as received from the UI or the user settings, into a Date
 *
 * Supported formats: ISO date string, epoch milliseconds, epoch seconds (as number or numeric string)
 *
 * @param expiration the expiration to be parsed
 * @returns the expiration as Date or `undefined` if it is missing or not valid (callers will treat the token as expired)
 */
export const parseExpiration = (expiration?: string | number | null): Date | undefined => {
    if (expiration === undefined || expiration === null || expiration === '')
        return undefined

    const isEpoch = typeof expiration === 'number' || /^\d+$/.test(expiration)
    let date: Date
    if (isEpoch) {
        const value = Number(expiration)
        date = new Date(value < MAX_EPOCH_SECONDS ? value * 1000 : value)
    }
    else {
        date = new Date(expiration)
    }

    return Number.isNaN(date.valueOf()) ? undefined : date
}
