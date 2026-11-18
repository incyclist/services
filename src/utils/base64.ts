const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * Checks whether a string looks like base64 encoded data (alphabet `A-Za-z0-9+/` followed by at most two `=` as padding).
 * An empty string is not base64. The length is not checked.
 *
 * @param value the string to be checked
 */
export const isBase64 = (value: string): boolean => /^[A-Za-z0-9+/]+={0,2}$/.test(value)

/**
 * Calculates the size of the content that a base64 string represents (without decoding it)
 *
 * @param base64 base64 encoded string (padding is taken into account)
 * @returns the size in bytes of the decoded content
 */
export const base64Size = (base64: string): number => {
    const padding = base64.endsWith('==') ? 2 : Number(base64.endsWith('='))
    return Math.floor(base64.length * 3 / 4) - padding
}

/**
 * Encodes binary data as base64 (portable: does not rely on `Buffer` or `btoa`, as this library also runs on React Native)
 *
 * @param bytes the data to be encoded
 * @returns the base64 string (padded with `=`)
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

const BASE64_LOOKUP: Record<string, number> = Object.fromEntries([...BASE64_CHARS].map((c, i) => [c, i]))

/**
 * Decodes base64 data (portable: does not rely on `Buffer` or `atob`). Padding is optional, line breaks and other whitespace are ignored.
 *
 * @param base64 the base64 string to be decoded
 * @returns the decoded bytes
 * @throws if the string contains characters that are not part of the base64 alphabet or has an impossible length
 */
export const fromBase64 = (base64: string): Uint8Array => {
    const compact = base64.replaceAll(/\s/g, '')
    let end = compact.length
    while (end > 0 && compact.charAt(end - 1) === '=')
        end--
    const clean = compact.slice(0, end)
    if (clean.length % 4 === 1)
        throw new Error('Invalid base64 length')

    const bytes = new Uint8Array(Math.floor(clean.length * 3 / 4))
    let acc = 0
    let bits = 0
    let pos = 0

    for (const char of clean) {
        const value = BASE64_LOOKUP[char]
        if (value === undefined)
            throw new Error('Invalid base64 character')

        acc = ((acc << 6) | value) & 0xFFFFFF
        bits += 6
        if (bits >= 8) {
            bits -= 8
            bytes[pos++] = (acc >> bits) & 0xFF
        }
    }
    return bytes
}
