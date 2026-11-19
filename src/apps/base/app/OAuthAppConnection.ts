import { Observer } from '../../../base/types'
import { valid } from '../../../utils/valid'
import { IExternalAppApi } from '../api/types'
import { OAuthAppCredentials } from '../types'
import { ConnectedAppService } from './ConnectedAppService'

/** Configuration of the API of an app that is connected via OAuth */
export type OAuthAppConfig = {
    accessToken: string
    refreshToken?: string
    expiration?: Date
}

/** The part of the API client that the connection depends on */
export interface IOAuthAppApi<Config> extends IExternalAppApi {
    /** @returns an Observer that emits `token.updated` whenever the tokens were refreshed */
    init(config: Config): Observer
    update(config: Partial<Config>): void
}

/**
 * Manages the connection to an app that is connected via the OAuth flow of the auth-server:
 * loads, validates and persists the credentials (`user.auth.<appKey>`) and owns the API client.
 *
 * The OAuth flow itself (and the refresh of the token) is handled by the auth-server, so no client id/secret is required here.
 *
 * A sub class only has to tell how the API client is created, how credentials and configuration are converted
 * and which operations are supported.
 */
export abstract class OAuthAppConnection<
    Credentials extends OAuthAppCredentials,
    Config extends OAuthAppConfig,
    Api extends IOAuthAppApi<Config>
> extends ConnectedAppService<Credentials> {

    // (declared only: the constructor of the base class initializes the connection, a field initializer would reset the result)
    protected declare config: Config
    protected declare api: Api

    /**
     * Connects with the credentials received from the auth-server.
     * If already connected, only the API configuration is updated.
     */
    async connect(credentials: Credentials): Promise<boolean> {

        this.ensureInitialized()

        this.logEvent({ message: `Connect with ${this.appName}` })

        try {
            const config = this.createConfig(credentials)

            if (this.isConnected()) {
                this.getApi().update(config)
            }
            else {
                this.initApi(config)
            }

            // also persist when re-connecting, as the refresh token of a previous connection is no longer valid
            this.saveCredentials(config)

            this.logEvent({ message: `Connect with ${this.appName} success` })
            return true
        }
        catch (err) {
            // Should never happen, but just in case ...  I will log
            // istanbul ignore next
            this.logError(err, 'connect')
            throw err
        }
    }

    /**
     * Indicates whether a connection attempt is currently in progress.
     *
     * @returns {boolean} Always false, as the OAuth flow is handled outside of this service.
     */
    isConnecting() {
        return false
    }

    disconnect(): void {
        try {
            this.config = undefined
            this.getApi().init(undefined)
            this.saveCredentials()
        }
        catch (err) {
            // Should never happen, but just in case ...  I will log
            // istanbul ignore next
            this.logError(err, 'disconnect')
        }
    }

    isConnected(): boolean {
        if (!this.isInitialized) {
            this.init()
        }

        return valid(this.config)
    }

    getCredentials(): Credentials {
        try {
            return this.getUserSettings().get(this.getSettingsKey(), null)
        }
        catch {
            return null
        }
    }

    getApi(): Api {
        if (!this.api)
            this.api = this.createApi()
        return this.api
    }

    /** the name of the app as shown in the logs */
    protected abstract get appName(): string

    protected abstract createApi(): Api

    /** converts the credentials (as received from the auth-server or persisted) into the configuration of the API client */
    protected abstract createConfig(credentials: Credentials): Config

    /** converts the configuration of the API client into the credentials that are persisted */
    protected abstract createCredentials(config: Config): Credentials

    protected getSettingsKey(): string {
        return `user.auth.${this.appKey}`
    }

    protected initAuth(): boolean {
        try {
            const auth = this.getCredentials()

            this.logEvent({ message: `${this.appName} init done`, hasCredentials: Boolean(auth) })
            if (auth) {
                this.config = this.createConfig(auth)
                this.initApi(this.config)
            }
            return true
        }
        catch (err) {
            this.logEvent({ message: 'error', error: err.message, fn: 'init', stack: err.stack })
            delete this.config
            return false
        }
    }

    protected updateConfig(config: Config) {
        const { accessToken, refreshToken, expiration } = config
        this.config = { ...this.config, accessToken, refreshToken, expiration }
        this.saveCredentials()
    }

    protected saveCredentials(config?: Config): void {

        if (config)
            this.config = config

        try {
            if (!this.isConnected()) {
                this.logEvent({ message: `${this.appName} Delete Credentials` })
                this.getUserSettings().set(this.getSettingsKey(), null)
                return
            }

            this.logEvent({ message: `${this.appName} Save Credentials` })
            this.getUserSettings().set(this.getSettingsKey(), this.createCredentials(this.config))
        }
        catch (err) {
            this.logEvent({ message: 'error', fn: 'saveCredentials', error: err.message, stack: err.stack })
            return
        }

        this.logEvent({ message: `${this.appName} Save Credentials done` })
    }

    protected initApi(config: Config) {
        const observer = this.getApi().init(config)
        observer.on('token.updated', (updated: Config) => { this.updateConfig(updated) })
        observer.on('auth.failed', () => {
            this.logEvent({ message: `${this.appName} authentication failed, credentials removed (reconnect required)` })
            this.disconnect()
        })
    }
}
