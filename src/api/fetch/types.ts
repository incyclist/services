export interface IFetchRequestInit {
    method?: string
    headers?: Record<string,string>
    body?: string
    referrerPolicy?: 'no-referrer' | 'no-referrer-when-downgrade' | 'origin' | 'origin-when-cross-origin' | 'same-origin' | 'strict-origin' | 'strict-origin-when-cross-origin' | 'unsafe-url'
}

export interface IFetchResponse {
    ok: boolean
    status: number
    statusText: string
    headers: Record<string,string>
    data: string
}

/**
 * Platform binding that issues an HTTP request from a trusted process (e.g. the
 * Electron main process), bypassing the renderer's CORS/referrer-policy enforcement.
 * Used where the caller needs full control over otherwise-forbidden headers
 * (Referer, User-Agent) - see `services/src/services/overpass/overpass.ts`.
 */
export interface IFetchBinding {
    fetch(url: string, init?: IFetchRequestInit): Promise<IFetchResponse>
}
