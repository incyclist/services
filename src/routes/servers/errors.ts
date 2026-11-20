import type { RouteServerNameErrorCode, RouteServerUrlErrorCode } from './types'

/** Thrown if the name or the address of a route server does not follow the rules. Nothing has been changed when it is thrown. */
export class RouteServerValidationError extends Error {
    constructor(
        public readonly field: 'name' | 'url',
        public readonly code: RouteServerNameErrorCode | RouteServerUrlErrorCode,
        message?: string
    ) {
        super(message ?? `invalid route server ${field}: ${code}`)
        this.name = 'RouteServerValidationError'
    }
}
