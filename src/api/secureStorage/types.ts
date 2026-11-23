/**
 * Platform binding for small secrets that must be stored encrypted at rest (Keychain on iOS,
 * Keystore-backed storage on Android). Used for the pairing secrets of the `local-link`: they must
 * never end up in the JSON repository or in the user settings.
 *
 * Optional on `IncyclistBindings`: features that need it stay inert when it is missing.
 */
export interface ISecureStorageBinding {
    /** The stored value, or `undefined` if there is none. */
    get(key: string): Promise<string | undefined>

    /** Stores (or replaces) a value; `false` if it could not be stored. */
    set(key: string, value: string): Promise<boolean>

    /** Deletes a value; `true` if it is gone afterwards (also when it never existed). */
    delete(key: string): Promise<boolean>
}
