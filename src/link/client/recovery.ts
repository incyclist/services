import { RECOVERY_MAX_PER_SESSION, RECOVERY_WINDOW_MS } from './consts'
import type { LinkRecoveryInfo } from './types'

/**
 * The limits of browsing the network for a paired computer whose saved address failed:
 * automatic browses run at most once per 10 minutes and 3 times per app session. A manual
 * "check again" is not subject to these limits. Any browse (also the one of Add Computer) starts
 * the 10-minute window, so that a computer that is simply switched off does not cause repeated
 * multicast traffic.
 *
 * Whether the app is idle is not decided here.
 */
export class LinkRecoveryGate {
    protected lastBrowseAt?: number
    protected autoCount = 0

    /** true if an automatic browse may run now */
    canAutoBrowse(now: number): boolean {
        return this.autoCount < RECOVERY_MAX_PER_SESSION && this.nextAutoBrowseAt() <= now
    }

    /** A browse starts now. */
    recordBrowse(automatic: boolean, now: number): void {
        this.lastBrowseAt = now
        if (automatic)
            this.autoCount++
    }

    info(now: number): LinkRecoveryInfo {
        const next = this.nextAutoBrowseAt()
        return {
            autoBrowsesUsed: this.autoCount,
            autoBrowsesMax: RECOVERY_MAX_PER_SESSION,
            nextAutoBrowseAt: next > now && this.autoCount < RECOVERY_MAX_PER_SESSION ? next : undefined,
        }
    }

    reset(): void {
        this.lastBrowseAt = undefined
        this.autoCount = 0
    }

    protected nextAutoBrowseAt(): number {
        return this.lastBrowseAt === undefined ? 0 : this.lastBrowseAt + RECOVERY_WINDOW_MS
    }
}
