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

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * Encodes binary data as base64 (portable: does not rely on `Buffer` or `btoa`, as this library also runs on React Native)
 */
export const toBase64 = (bytes: Uint8Array): string => {
    let result = ''
    for (let i = 0; i < bytes.length; i += 3) {
        const b0 = bytes[i]
        const b1 = bytes[i + 1]
        const b2 = bytes[i + 2]
        const n = (b0 << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0)

        result += BASE64_CHARS[(n >> 18) & 63] + BASE64_CHARS[(n >> 12) & 63]
        result += b1 === undefined ? '=' : BASE64_CHARS[(n >> 6) & 63]
        result += b2 === undefined ? '=' : BASE64_CHARS[n & 63]
    }
    return result
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
