import { getBindings } from '../../api/bindings'
import type { LinkClientPlatform } from './types'

interface PipeInfo {
    upstreamHost: string
    upstreamPort: number
    port: number
}

const formatHost = (host: string): string => host.includes(':') && !host.startsWith('[') ? `[${host}]` : host

/**
 * Decides how media requests reach a computer's media port and owns the loopback pipes.
 *
 * - iOS (and anything else): direct `http://<host>:<mediaPort>`, unless the pipe is switched on
 *   and the pipe binding exists.
 * - Android: always through the loopback pipe, `http://127.0.0.1:<pipePort>`. Without the pipe
 *   binding media is unavailable (cleartext HTTP to a LAN address is blocked by the OS).
 *
 * A pipe is started on demand, for one fixed upstream, and stopped by {@link release}. The pipe
 * itself is implemented by the app (see `ILoopbackPipeBinding`).
 */
export class LinkMediaPath {
    protected pipes = new Map<string, PipeInfo>()
    protected starting = new Map<string, Promise<PipeInfo | undefined>>()
    protected switchedOn = false

    constructor(protected getPlatform: () => LinkClientPlatform) {}

    /** iOS only: route media through the pipe as well (a hot switch, in case direct HTTP shows a problem). */
    setPipeEnabled(enabled: boolean): void {
        this.switchedOn = enabled
    }

    /** true if media can be played on this platform with the bindings that are present */
    isAvailable(): boolean {
        return this.getPlatform() !== 'android' || this.hasPipe()
    }

    usesPipe(): boolean {
        return this.getPlatform() === 'android' || (this.switchedOn && this.hasPipe())
    }

    /**
     * The base URL (no trailing slash, no token) for the media of one computer, or `undefined` if
     * media is unavailable.
     */
    async getBaseUrl(linkId: string, host: string, mediaPort: number): Promise<string | undefined> {
        if (!this.isAvailable() || !(mediaPort > 0))
            return undefined
        if (!this.usesPipe())
            return `http://${formatHost(host)}:${mediaPort}`
        const pipe = await this.ensurePipe(linkId, host, mediaPort)
        return pipe ? `http://127.0.0.1:${pipe.port}` : undefined
    }

    /** Stops the pipe of one computer, or every pipe. */
    async release(linkId?: string): Promise<void> {
        const ids = linkId === undefined ? [...this.pipes.keys()] : [linkId]
        for (const id of ids)
            await this.stopPipe(id)
    }

    protected hasPipe(): boolean {
        return getBindings()?.loopbackPipe !== undefined
    }

    protected async ensurePipe(linkId: string, host: string, mediaPort: number): Promise<PipeInfo | undefined> {
        const existing = this.pipes.get(linkId)
        if (existing?.upstreamHost === host && existing.upstreamPort === mediaPort)
            return existing

        const key = `${linkId}|${host}|${mediaPort}`
        let start = this.starting.get(key)
        if (!start) {
            start = this.startPipe(linkId, host, mediaPort).finally(() => this.starting.delete(key))
            this.starting.set(key, start)
        }
        return await start
    }

    protected async startPipe(linkId: string, host: string, mediaPort: number): Promise<PipeInfo | undefined> {
        await this.stopPipe(linkId)
        try {
            const started = await getBindings().loopbackPipe!.start({ upstreamHost: host, upstreamPort: mediaPort })
            const info = { upstreamHost: host, upstreamPort: mediaPort, port: started.port }
            this.pipes.set(linkId, info)
            return info
        }
        catch {
            return undefined
        }
    }

    protected async stopPipe(linkId: string): Promise<void> {
        const pipe = this.pipes.get(linkId)
        if (!pipe)
            return
        this.pipes.delete(linkId)
        try {
            await getBindings().loopbackPipe?.stop(pipe.port)
        }
        catch {
            // the pipe is gone either way
        }
    }
}
