/**
 * Platform binding for the loopback byte pipe (mobile only).
 *
 * Video players on Android cannot open cleartext HTTP connections to a LAN address, but they can
 * open one to the loopback address. The pipe is a TCP listener on the phone that forwards every
 * accepted connection to one fixed upstream (the media port of a paired computer) and copies
 * bytes in both directions. It does not parse HTTP.
 *
 * Contract of an implementation:
 * - the listener is bound to `127.0.0.1` only (never to all interfaces) on a random port;
 * - every accepted connection gets its own upstream connection, bytes are copied unchanged in both
 *   directions, and the connection closes when either side closes;
 * - at least 8 connections work at the same time;
 * - the upstream is the one given to `start`, so the pipe cannot be used as a proxy to anywhere else.
 *
 * Optional on `IncyclistBindings`: when it is missing, media that needs the pipe is unavailable.
 */

/** Where the pipe forwards to. */
export interface LoopbackPipeOptions {
    upstreamHost: string
    upstreamPort: number
}

export interface ILoopbackPipeBinding {
    /**
     * Starts a pipe to the given upstream.
     *
     * @returns the loopback port players connect to
     * @throws when the listener cannot be started
     */
    start(opts: LoopbackPipeOptions): Promise<{ port: number }>

    /**
     * Stops one pipe (by its loopback port) or, without a port, every pipe. Open connections are closed.
     */
    stop(port?: number): Promise<void>
}
