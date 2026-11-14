import { Singleton } from '../../base/decorators'
import { valid } from '../../utils/valid'
import { TrainingPeaksApi, TrainingPeaksConfig } from '../base/api'
import { ConnectedAppService } from '../base/app'
import { parseExpiration } from '../base/utils'
import { AppsOperation } from '../types'
import { TrainingPeaksCredentials } from './types'

const SETTINGS_KEY = 'user.auth.trainingpeaks'

/**
 * Manages the connection to TrainingPeaks: loads, validates and persists the credentials
 * and owns the TrainingPeaksApi instance.
 *
 * The OAuth flow itself (and the token refresh) is handled by the auth-server, so no
 * client id/secret is required here.
 */
@Singleton
export class TrainingPeaksAppConnection extends ConnectedAppService<TrainingPeaksCredentials> {
    protected config: TrainingPeaksConfig
    protected api: TrainingPeaksApi
    protected tokenUpdateHandler = this.updateConfig.bind(this)

    constructor() {
        super('TrainingPeaksAppConnection', 'trainingpeaks')
    }

    /**
     * Connects with the credentials received from the auth-server.
     * If already connected, only the API configuration is updated.
     */
    async connect(credentials: TrainingPeaksCredentials): Promise<boolean> {

        this.ensureInitialized()

        this.logEvent({ message: 'Connect with TrainingPeaks' })

        try {
            const isConnected = this.isConnected()
            const config = this.buildConfigFromCredentials(credentials)

            if (isConnected) {
                this.getApi().update(config)
            }
            else {
                this.initApi(config)
            }

            // also persist when re-connecting, as the refresh token of a previous connection is no longer valid
            this.saveCredentials(config)

            this.logEvent({ message: 'Connect with TrainingPeaks success' })
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

    getCredentials(): TrainingPeaksCredentials {
        try {
            return this.getUserSettings().get(SETTINGS_KEY, null)
        }
        catch {
            return null
        }
    }

    getApi() {
        if (!this.api)
            this.api = new TrainingPeaksApi()
        return this.api
    }

    getSupportedOperations(): AppsOperation[] {
        return ['ActivityUpload','WorkoutDownload']
    }

    getDefaultOperations(): AppsOperation[] {
        return ['ActivityUpload','WorkoutDownload']
    }

    protected initAuth(): boolean {
        let isInitialized: boolean

        try {
            const auth = this.getCredentials()

            if (auth) {
                this.logEvent({ message: 'TrainingPeaks init done', hasCredentials: true })
                this.config = this.buildConfigFromCredentials(auth)
                this.initApi(this.config)
            }
            else {
                this.logEvent({ message: 'TrainingPeaks init done', hasCredentials: false })
            }
            isInitialized = true
        }
        catch (err) {
            this.logEvent({ message: 'error', error: err.message, fn: 'init', stack: err.stack })
            isInitialized = false
            delete this.config
        }

        return isInitialized
    }

    protected updateConfig(config: TrainingPeaksConfig) {
        const { accessToken, refreshToken, expiration } = config
        this.config = { ...this.config, accessToken, refreshToken, expiration }
        this.saveCredentials()
    }

    protected saveCredentials(config?: TrainingPeaksConfig): void {

        if (config)
            this.config = config

        try {
            if (!this.isConnected()) {
                this.logEvent({ message: 'TrainingPeaks Delete Credentials' })
                this.getUserSettings().set(SETTINGS_KEY, null)
                return
            }

            this.logEvent({ message: 'TrainingPeaks Save Credentials' })
            this.getUserSettings().set(SETTINGS_KEY, {
                id: this.config.id,
                accesstoken: this.config.accessToken,
                refreshtoken: this.config.refreshToken,
                expiration: this.config.expiration?.toISOString()
            })
        }
        catch (err) {
            this.logEvent({ message: 'error', fn: 'saveCredentials', error: err.message, stack: err.stack })
            return
        }

        this.logEvent({ message: 'TrainingPeaks Save Credentials done' })
    }

    protected buildConfigFromCredentials(credentials: TrainingPeaksCredentials): TrainingPeaksConfig {
        return {
            id: credentials?.id === undefined ? undefined : String(credentials.id),
            accessToken: credentials?.accesstoken,
            refreshToken: credentials?.refreshtoken,
            expiration: parseExpiration(credentials?.expiration)
        }
    }

    protected initApi(config: TrainingPeaksConfig) {
        const observer = this.getApi().init(config)
        observer.on('token.updated', this.tokenUpdateHandler)
    }
}
