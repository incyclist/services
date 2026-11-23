import { EventLogger } from 'gd-eventlog'
import { LINK_MDNS_TYPE, WATCH_ON_MS, WATCH_PERIOD_MS } from './consts'
import type { LinkMdnsAnnouncement, LinkWifiBinding } from './types'

export interface LinkWatchProps {
    getWifi: () => LinkWifiBinding | undefined
    /** the conditions of the watch (foreground, idle, a computer without a session) hold now */
    canRun: () => boolean
    /** the trainer discovery is running a rotation that the watch can join */
    isJoined: () => boolean
    onAnnouncement: (service: LinkMdnsAnnouncement) => void
}

type WatchMode = 'joined' | 'duty'

/**
 * Listens for `_incyclist._tcp` through the mobile mDNS binding while a paired computer has no
 * session, so that a computer that comes back is found within seconds, without polling.
 *
 * - When the trainer discovery runs a rotation, the watch is one more browser in it (`joined`).
 * - Otherwise it browses for {@link WATCH_ON_MS} of every {@link WATCH_PERIOD_MS} (`duty`), so
 *   that the Android multicast lock is not held permanently.
 *
 * The watch only ever stops its own browser (`stopFind`), never the whole binding, which the
 * trainer discovery shares. A binding without `stopFind` is not watched. {@link sync} is
 * idempotent and cheap: call it whenever a condition may have changed, and after anything that
 * may have reset the binding (pause/resume of the background activity, an exclusive browse).
 *
 * Nothing here throws.
 */
export class LinkWatch {
    protected mode?: WatchMode
    protected armed = false
    protected cycleTimer?: ReturnType<typeof setTimeout>
    protected stopTimer?: ReturnType<typeof setTimeout>
    protected logger = new EventLogger('LinkWatch')

    constructor(protected props: LinkWatchProps) {}

    protected logError(err: Error, fn: string): void {
        try {
            this.logger.logEvent({ message: 'Error', fn, error: err?.message, stack: err?.stack })
        }
        catch {
            // nothing left to report to
        }
    }

    /** true while the watch is on (also between the browse windows of the duty cycle) */
    isRunning(): boolean {
        return this.mode !== undefined
    }

    /** true while the browser of the watch is registered in the binding */
    isArmed(): boolean {
        return this.armed
    }

    /** Starts the watch, re-arms it, switches its mode, or stops it, depending on the conditions now. */
    sync(): void {
        try {
            if (!this.canRun()) {
                this.halt()
                return
            }
            const mode: WatchMode = this.props.isJoined() ? 'joined' : 'duty'
            if (mode !== this.mode) {
                this.clearTimers()
                this.release()
                this.mode = mode
                this.begin()
                return
            }
            // a pause/resume or an exclusive browse may have dropped the browser: put it back
            if (this.armed)
                this.arm()
        }
        catch (err) {
            this.logError(err as Error, 'sync')
        }
    }

    /** Stops the watch and releases its browser. */
    halt(): void {
        try {
            this.clearTimers()
            this.release()
            this.mode = undefined
        }
        catch (err) {
            this.logError(err as Error, 'halt')
        }
    }

    protected canRun(): boolean {
        return typeof this.props.getWifi()?.mdns?.stopFind === 'function' && this.props.canRun()
    }

    protected begin(): void {
        this.arm()
        if (this.mode === 'duty')
            this.stopTimer = setTimeout(() => this.endWindow(), WATCH_ON_MS)
        this.cycleTimer = setTimeout(() => this.nextCycle(), WATCH_PERIOD_MS)
    }

    protected endWindow(): void {
        this.stopTimer = undefined
        this.release()
    }

    /** Next duty window, or the periodic re-check of a joined watch. */
    protected nextCycle(): void {
        this.cycleTimer = undefined
        try {
            if (!this.canRun()) {
                this.halt()
                return
            }
            const mode: WatchMode = this.props.isJoined() ? 'joined' : 'duty'
            if (mode !== this.mode) {
                this.sync()
                return
            }
            this.clearTimers()
            this.begin()
        }
        catch (err) {
            this.logError(err as Error, 'nextCycle')
        }
    }

    protected arm(): void {
        try {
            const mdns = this.props.getWifi()?.mdns
            if (!mdns)
                return
            // idempotent: neither of both resets what the trainer discovery has registered
            mdns.connect()
            mdns.find({ type: LINK_MDNS_TYPE, protocol: 'tcp' }, service => this.onup(service))
            this.armed = true
        }
        catch (err) {
            this.logError(err as Error, 'arm')
        }
    }

    protected release(): void {
        if (!this.armed)
            return
        this.armed = false
        try {
            this.props.getWifi()?.mdns?.stopFind?.(LINK_MDNS_TYPE, 'tcp')
        }
        catch (err) {
            this.logError(err as Error, 'release')
        }
    }

    protected clearTimers(): void {
        clearTimeout(this.cycleTimer)
        clearTimeout(this.stopTimer)
        this.cycleTimer = undefined
        this.stopTimer = undefined
    }

    protected onup(service: LinkMdnsAnnouncement): void {
        try {
            // some bindings deliver every announcement to every callback
            if (!service?.address || !service.port || (service.type && service.type !== LINK_MDNS_TYPE))
                return
            this.props.onAnnouncement(service)
        }
        catch (err) {
            this.logError(err as Error, 'onup')
        }
    }
}
