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


const MAX_ERROR_DETAIL = 500

/**
 * Converts the body of an error response into a short text that explains why a request was rejected
 * @returns the text (at most 500 characters, longer texts end with `...`) or `undefined` if there is no body
 */
export const getErrorDetail = (data: unknown): string | undefined => {
    if (data === undefined || data === null || data === '')
        return undefined

    const text = typeof data === 'string' ? data : JSON.stringify(data)
    return text.length > MAX_ERROR_DETAIL ? text.substring(0, MAX_ERROR_DETAIL) + '...' : text
}

/**
 * Formats a day as `YYYY-MM-DD`
 * @param day a Date (local day) or a string that is already formatted
 */
export const formatDay = (day: string | Date): string => {
    if (typeof day === 'string')
        return day

    const month = String(day.getMonth() + 1).padStart(2, '0')
    const date = String(day.getDate()).padStart(2, '0')
    return `${day.getFullYear()}-${month}-${date}`
}
