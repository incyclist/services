const TOKEN_PARAM = /([?&;]t=)[^\s"'<>&#]*/gi

const isLetter = (c: string): boolean => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
const isSchemeChar = (c: string): boolean => isLetter(c) || (c >= '0' && c <= '9') || c === '+' || c === '.' || c === '-'
const isBodyChar = (c: string): boolean => !/\s/.test(c) && !'"\'<>?#'.includes(c)
const isTailChar = (c: string): boolean => !/\s/.test(c) && !'"\'<>)'.includes(c)

/**
 * Cuts the query string and fragment off every `scheme://...` URL, in linear time (a regular expression
 * for this backtracks super-linearly). A start inside a scheme run leads to the same end as the run's
 * first letter, and a failed body scan is reused by the starts that fall into it.
 */
const stripUrlQueries = (text: string): string => {
    const n = text.length
    let out = ''
    let copied = 0
    let i = 0
    let failFrom = -1
    let failTo = -1
    while (i < n) {
        if (!isLetter(text[i])) {
            i++
            continue
        }
        let schemeEnd = i
        while (schemeEnd < n && isSchemeChar(text[schemeEnd]))
            schemeEnd++
        const bodyStart = schemeEnd + 3
        if (!text.startsWith('://', schemeEnd) || (bodyStart >= failFrom && bodyStart <= failTo)) {
            i = schemeEnd
            continue
        }
        let bodyEnd = bodyStart
        while (bodyEnd < n && isBodyChar(text[bodyEnd]))
            bodyEnd++
        if (bodyEnd >= n || (text[bodyEnd] !== '?' && text[bodyEnd] !== '#')) {
            failFrom = bodyStart
            failTo = bodyEnd
            i = schemeEnd
            continue
        }
        let tailEnd = bodyEnd + 1
        while (tailEnd < n && isTailChar(text[tailEnd]))
            tailEnd++
        out += text.slice(copied, bodyEnd)
        copied = tailEnd
        i = tailEnd
    }
    return out + text.slice(copied)
}

/**
 * Removes media-token material from a text that is about to be logged: the query string and
 * fragment of every URL, and the value of any remaining `t=` parameter. Safe to call with
 * anything; non-strings are returned unchanged.
 *
 * @param text a URL, an error message or any other log text
 */
export const scrubTokens = <T>(text: T): T => {
    if (typeof text !== 'string')
        return text
    return stripUrlQueries(text).replaceAll(TOKEN_PARAM, '$1***') as T
}

/** An error whose message is scrubbed with {@link scrubTokens}; the original is returned if nothing changes. */
export const scrubError = <T extends Error>(err: T): T | Error => {
    const message = err?.message
    const clean = scrubTokens(message)
    if (typeof message !== 'string' || clean === message)
        return err
    const copy = new Error(clean)
    copy.name = err.name
    return copy
}
