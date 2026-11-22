import semver from 'semver'
import type { LinkClientPlatform } from './types'

/**
 * Minimum installed NATIVE app version per platform that can carry the phone side of the link.
 * Mobile ships its JS over the air onto arbitrarily old native binaries, so the bundle cannot
 * assume the native layer it needs is there.
 *
 * `undefined` means "not released yet": the platform is then NOT supported (fails closed).
 *
 * TO FILL IN once the native releases have shipped (use the version the store shows for the app):
 * - ios:     the first release whose Info.plist lists `_incyclist._tcp` in `NSBonjourServices`
 * - android: the first release carrying the loopback network security config
 *            (not the earlier release that only added the `pair` host to the intent filter)
 */
export const LINK_MIN_NATIVE_VERSION: Record<'ios' | 'android', string | undefined> = {
    ios: undefined,
    android: undefined,
}

const PLAIN_VERSION = /^\d+(\.\d+){0,2}$/

function parse(version: unknown): semver.SemVer | undefined {
    if (typeof version !== 'string')
        return undefined
    const trimmed = version.trim()
    if (!PLAIN_VERSION.test(trimmed))
        return undefined
    return semver.coerce(trimmed) ?? undefined
}

/**
 * true if the installed native version is at or above the minimum of its platform.
 * false (never throws) if the platform is not iOS or Android, the minimum is not released yet,
 * or either version cannot be parsed.
 */
export function meetsNativeVersion(
    platform: LinkClientPlatform,
    installed: unknown,
    minimums: Record<'ios' | 'android', string | undefined> = LINK_MIN_NATIVE_VERSION,
): boolean {
    if (platform !== 'ios' && platform !== 'android')
        return false
    const min = parse(minimums[platform])
    const current = parse(installed)
    if (!min || !current)
        return false
    return semver.gte(current, min)
}
