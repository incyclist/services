const TOKEN_PARAM = /([?&;]t=)[^\s"'<>&#]*/gi

const isLetter = (c: string): boolean => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
const isSchemeChar = (c: string): boolean => isLetter(c) || (c >= '0' && c <= '9') || c === '+' || c === '.' || c === '-'
const isBodyChar = (c: string): boolean => !/\s/.test(c) && !'"\'<>?#'.includes(c)
const isTailChar = (c: string): boolean => !/\s/.test(c) && !'"\'<>)'.includes(c)

const skipWhile = (text: string, from: number, test: (c: string) => boolean): number => {
    let end = from
    while (end < text.length && test(text[end]))
        end++
    return end
}

interface UrlScan {
    /** end of the part that is kept (the URL without query), -1 if there is no query */
    keepEnd: number
    /** end of the removed part */
    tailEnd: number
    /** the scheme run ends here */
    schemeEnd: number
    /** a failed body scan: starts from `bodyStart` up to `bodyEnd` fail alike */
    failed?: { from: number, to: number }
}

const scanUrlAt = (text: string, start: number, failed: { from: number, to: number }): UrlScan => {
    const schemeEnd = skipWhile(text, start, isSchemeChar)
    const none = { keepEnd: -1, tailEnd: -1, schemeEnd }
    const bodyStart = schemeEnd + 3
    if (!text.startsWith('://', schemeEnd) || (bodyStart >= failed.from && bodyStart <= failed.to))
        return none
    const bodyEnd = skipWhile(text, bodyStart, isBodyChar)
    if (text[bodyEnd] !== '?' && text[bodyEnd] !== '#')
        return { ...none, failed: { from: bodyStart, to: bodyEnd } }
    return { keepEnd: bodyEnd, tailEnd: skipWhile(text, bodyEnd + 1, isTailChar), schemeEnd }
}

/**
 * Cuts the query string and fragment off every `scheme://...` URL, in linear time (a regular expression
 * for this backtracks super-linearly). A start inside a scheme run leads to the same end as the run's
 * first letter, and a failed body scan is reused by the starts that fall into it.
 */
const stripUrlQueries = (text: string): string => {
    let out = ''
    let copied = 0
    let i = 0
    let failed = { from: -1, to: -1 }
    while (i < text.length) {
        if (!isLetter(text[i])) {
            i++
            continue
        }
        const scan = scanUrlAt(text, i, failed)
        failed = scan.failed ?? failed
        if (scan.keepEnd < 0) {
            i = scan.schemeEnd
            continue
        }
        out += text.slice(copied, scan.keepEnd)
        copied = scan.tailEnd
        i = scan.tailEnd
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
