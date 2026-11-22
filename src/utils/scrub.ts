const URL_WITH_QUERY = /([a-z][\d+.a-z-]*:\/\/[^\s"'<>?#]*)[?#][^\s"'<>)]*/gi
const TOKEN_PARAM = /([?&;]t=)[^\s"'<>&#]*/gi

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
    return text.replaceAll(URL_WITH_QUERY, '$1').replaceAll(TOKEN_PARAM, '$1***') as T
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
