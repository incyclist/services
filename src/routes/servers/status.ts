import { Singleton } from '../../base/decorators'
import { IncyclistService } from '../../base/service'
import type { RouteServerLoadResult, RouteServerStatus } from './types'

/**
 * Keeps the outcome of the last load per route server. It is in memory only: before a server
 * was loaded in this session its status is 'unknown'.
 */
@Singleton
export class RouteServerStatusStore extends IncyclistService {
    protected results: Map<string, RouteServerLoadResult> = new Map()
    protected loading: Set<string> = new Set()

    constructor() {
        super('RouteServerStatus')
    }

    setLoading(key: string) {
        this.loading.add(key)
        this.emit('changed', key)
    }

    setResult(key: string, result: RouteServerLoadResult) {
        this.loading.delete(key)
        this.results.set(key, result)
        this.logEvent({ message: 'route server status', key, status: result.status, routeCount: result.routeCount })
        this.emit('changed', key)
    }

    /** a load that ended without a result (e.g. stopped): the previous result stays valid */
    clearLoading(key: string) {
        if (this.loading.delete(key))
            this.emit('changed', key)
    }

    remove(key: string) {
        this.loading.delete(key)
        this.results.delete(key)
        this.emit('changed', key)
    }

    getStatus(key: string): RouteServerStatus {
        if (this.loading.has(key))
            return 'loading'
        return this.results.get(key)?.status ?? 'unknown'
    }

    getResult(key: string): RouteServerLoadResult | undefined {
        return this.results.get(key)
    }

    reset() {
        this.loading.clear()
        this.results.clear()
        super.reset()
    }
}

export const useRouteServerStatus = () => new RouteServerStatusStore()
