import { LINK_MDNS_TYPE } from './consts'
import type { LinkMdnsAnnouncement, LinkWifiBinding } from './types'

/** A computer as the browse reports it. */
export interface BrowseResult {
    name: string
    host: string
    port: number
}

const NAME_WITH_SUFFIX = /^(.*\S)\s+\(([A-Z0-9]{4})\)$/

/** Splits an announced instance name `<display name> (<suffix>)`. */
export const parseInstanceName = (name: string): { displayName: string, suffix?: string } => {
    const match = NAME_WITH_SUFFIX.exec(name)
    return match ? { displayName: match[1], suffix: match[2] } : { displayName: name }
}

/**
 * One scoped, time-boxed browse for `_incyclist._tcp` through the mobile mDNS binding.
 *
 * The binding keeps one browse running at a time, so the caller must have taken the exclusive
 * use of network discovery before and gives it back after {@link run}. The browser is released
 * (`disconnect`) when the browse ends, whatever the reason.
 */
export class LinkBrowse {
    protected cancelled = false
    protected finish?: () => void

    constructor(protected wifi: LinkWifiBinding) {}

    /**
     * @param timeoutMs length of the browse
     * @param onFound called once for each distinct computer, as soon as it is found
     * @returns every computer found
     */
    async run(timeoutMs: number, onFound?: (found: BrowseResult) => void): Promise<BrowseResult[]> {
        const found = new Map<string, BrowseResult>()
        const onup = (service: LinkMdnsAnnouncement) => {
            if (this.cancelled || !service?.address || !service.port)
                return
            // some bindings deliver every announcement to every callback
            if (service.type && service.type !== LINK_MDNS_TYPE)
                return
            const id = `${service.address}:${service.port}`
            if (found.has(id))
                return
            const result = { name: service.name ?? '', host: service.address, port: service.port }
            found.set(id, result)
            onFound?.(result)
        }

        try {
            this.wifi.mdns.connect()
            this.wifi.mdns.find({ type: LINK_MDNS_TYPE, protocol: 'tcp' }, onup)
            await new Promise<void>(resolve => {
                const timer = setTimeout(resolve, timeoutMs)
                this.finish = () => { clearTimeout(timer); resolve() }
                if (this.cancelled)
                    this.finish()
            })
        }
        finally {
            this.release()
        }
        return [...found.values()]
    }

    /** Ends the browse early; `run()` resolves with what was found so far. */
    cancel(): void {
        this.cancelled = true
        this.finish?.()
    }

    protected release(): void {
        try {
            this.wifi.mdns.disconnect()
        }
        catch {
            // best effort: the binding may already be disconnected
        }
    }
}
