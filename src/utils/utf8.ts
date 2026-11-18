/**
 * Encodes text as UTF-8 without relying on `TextEncoder` or `Buffer` (fallback for platforms that do not provide `TextEncoder`).
 * Slow for large texts, as every character is handled separately
 *
 * @param text the text to be encoded
 * @returns the UTF-8 bytes
 */
export const utf8EncodeFallback = (text: string): Uint8Array => {
    const bytes: number[] = []
    for (const char of text) {
        const cp = char.codePointAt(0)
        if (cp < 0x80)
            bytes.push(cp)
        else if (cp < 0x800)
            bytes.push(0xC0 | (cp >> 6), 0x80 | (cp & 63))
        else if (cp < 0x10000)
            bytes.push(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63))
        else
            bytes.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63))
    }
    return new Uint8Array(bytes)
}

/** @returns the number of continuation bytes that follow a UTF-8 lead byte (-1 if it is not a lead byte) */
const getUtf8Extra = (lead: number): number => {
    if (lead < 0x80) return 0
    if (lead >= 0xF0 && lead < 0xF8) return 3
    if (lead >= 0xE0 && lead < 0xF0) return 2
    if (lead >= 0xC0 && lead < 0xE0) return 1
    return -1
}

/**
 * Decodes UTF-8 bytes to text without relying on `TextDecoder` or `Buffer` (fallback for platforms that do not provide `TextDecoder`).
 * Invalid sequences are replaced by U+FFFD.
 *
 * @param bytes the UTF-8 bytes to be decoded
 * @returns the decoded text
 */
export const utf8DecodeFallback = (bytes: Uint8Array): string => {
    const parts: string[] = []
    let i = 0

    while (i < bytes.length) {
        const lead = bytes[i]
        const extra = getUtf8Extra(lead)
        let cp = extra > 0 ? lead & (0x3F >> extra) : lead
        let valid = extra >= 0 && i + extra < bytes.length

        for (let k = 1; valid && k <= extra; k++) {
            valid = (bytes[i + k] & 0xC0) === 0x80
            cp = (cp << 6) | (bytes[i + k] & 0x3F)
        }

        if (valid && cp <= 0x10FFFF) {
            parts.push(String.fromCodePoint(cp))
            i += extra + 1
        }
        else {
            parts.push('�')
            i++
        }
    }
    return parts.join('')
}

/**
 * Encodes text as UTF-8 (portable: uses `TextEncoder` if the platform provides it, otherwise a hand-written encoder)
 *
 * @param text the text to be encoded
 * @returns the UTF-8 bytes
 */
export const utf8Encode = (text: string): Uint8Array => {
    return typeof globalThis.TextEncoder === 'function'
        ? new globalThis.TextEncoder().encode(text)
        : utf8EncodeFallback(text)
}

/**
 * Decodes UTF-8 bytes to text (portable: uses `TextDecoder` if the platform provides it, otherwise a hand-written decoder).
 * A byte order mark is kept, invalid sequences are replaced by U+FFFD.
 *
 * @param bytes the UTF-8 bytes to be decoded
 * @returns the decoded text
 */
export const utf8Decode = (bytes: Uint8Array): string => {
    return typeof globalThis.TextDecoder === 'function'
        ? new globalThis.TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
        : utf8DecodeFallback(bytes)
}
