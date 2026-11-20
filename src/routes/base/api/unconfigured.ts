import { IIncyclistRoutesApi, RouteApiDescription, RouteApiDetail } from "./types";

/**
 * Stands in for the api of a route server that is not (or no longer) configured. It never issues a request:
 * every call that would need the server fails with a clear error.
 */
export class UnconfiguredRoutesApi implements IIncyclistRoutesApi {

    constructor( protected readonly source:string ) {}

    protected unavailable():Error {
        return Object.assign( new Error(`route server '${this.source}' is not configured`), {code:'ERR_ROUTE_SERVER_NOT_CONFIGURED'})
    }

    async getRouteDescriptions(): Promise<Array<RouteApiDescription>> {
        throw this.unavailable()
    }

    async getRouteDetails(): Promise<RouteApiDetail> {
        throw this.unavailable()
    }

    async getRoutePreview(): Promise<string> {
        throw this.unavailable()
    }

    async reload():Promise<void> {
        // nothing to reload
    }
}
