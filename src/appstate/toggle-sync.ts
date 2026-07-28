import { getBindings } from "../api";
import { IMessageQueueBinding } from "../api/mq";
import { Injectable } from "../base/decorators";
import { IncyclistService } from "../base/service";
import { Singleton } from "../base/types/singleton";
import { useUserSettings } from "../settings";
import { UserSettingsService } from "../settings/service/service";
import { FeatureToggle } from "./types";

const TOPIC_PREFIX = 'features'

/**
 * Receives remote feature toggle updates over MQTT and applies them to the local user settings.
 *
 * A (future) backend "feature-toggle" microservice publishes changed toggle values to
 * `features/<uuid>/<toggle-name>` (payload `{value:boolean}`) whenever it is notified - via the
 * already-existing `incyclist/session/${session}/start` message - that a client with a given
 * uuid has started a session.
 *
 * This service only implements the client-side receiving half: once it knows the user's uuid, it
 * subscribes to `features/<uuid>/+` and, for every message received on that subscription, stores
 * the toggle value under the same settings key that `AppStateService.hasFeature()` reads.
 *
 * There is no polling and no acknowledgement/confirmation flow: this is fire-and-forget. A client
 * that is offline when the backend pushes a change simply keeps its last-known local value until
 * its next session start.
 *
 * @noInheritDoc
 */
@Singleton
export class FeatureToggleSyncService extends IncyclistService {

    protected uuid: string
    protected subscribed: boolean = false
    protected onMessageHandler = this.onMessage.bind(this)

    constructor() {
        super('FeatureToggleSync')
    }

    /**
     * Starts (or restarts) the toggle subscription for the given user.
     *
     * Safe to call multiple times (e.g. on every app launch/resume): if already subscribed for
     * the same uuid, this is a no-op; if the uuid changed, the previous subscription is torn down
     * first.
     *
     * @param uuid - the local user's uuid, as stored in user settings under `uuid`
     */
    start(uuid: string) {
        try {
            if (!uuid)
                return

            if (this.subscribed && this.uuid === uuid)
                return

            if (this.subscribed)
                this.stop()

            const mq = this.getMessageQueue()
            if (!mq?.enabled?.())
                return

            this.uuid = uuid
            mq.on('mq-message', this.onMessageHandler)
            mq.subscribe(this.getTopic(uuid))
            this.subscribed = true
        }
        catch (err) {
            this.logError(err, 'start')
        }
    }

    /**
     * Stops the toggle subscription (if any). Not required as part of the normal app lifecycle
     * today, but provided so callers (and tests) can cleanly tear down a subscription, e.g. when
     * the uuid changes.
     */
    stop() {
        try {
            if (!this.subscribed)
                return

            const mq = this.getMessageQueue()
            if (mq) {
                mq.off('mq-message', this.onMessageHandler)
                if (this.uuid)
                    mq.unsubscribe(this.getTopic(this.uuid))
            }
        }
        catch (err) {
            this.logError(err, 'stop')
        }
        finally {
            this.subscribed = false
        }
    }

    protected getTopic(uuid: string): string {
        return `${TOPIC_PREFIX}/${uuid}/+`
    }

    protected onMessage(topic: string, message: string | Uint8Array) {
        try {
            const toggleName = this.parseToggleName(topic)
            if (!toggleName)
                return

            const payload = this.parsePayload(message)
            if (!payload || typeof payload.value !== 'boolean')
                return

            this.getUserSettings().set(toggleName, payload.value)
        }
        catch (err) {
            this.logError(err, 'onMessage', { topic })
        }
    }

    protected parseToggleName(topic: string): FeatureToggle | undefined {
        if (!this.uuid || typeof topic !== 'string')
            return undefined

        const prefix = `${TOPIC_PREFIX}/${this.uuid}/`
        if (!topic.startsWith(prefix))
            return undefined

        const toggleName = topic.slice(prefix.length)
        if (!toggleName || toggleName.includes('/'))
            return undefined

        return toggleName as FeatureToggle
    }

    protected parsePayload(message: string | Uint8Array): { value?: boolean } | undefined {
        try {
            let str: string
            if (typeof message === 'string')
                str = message
            else if (message instanceof Uint8Array)
                str = Buffer.from(message.buffer).toString()
            else
                return undefined

            return JSON.parse(str)
        }
        catch {
            return undefined
        }
    }

    @Injectable
    protected getMessageQueue(): IMessageQueueBinding {
        return getBindings().mq
    }

    @Injectable
    protected getUserSettings(): UserSettingsService {
        return useUserSettings()
    }
}

export const useFeatureToggleSync = () => new FeatureToggleSyncService()
