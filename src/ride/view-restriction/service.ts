import { getBindings } from '../../api'
import { MAPS_KEY_HELP_URL, MAPS_KEY_TEXTS } from '../../apps/googleMaps/consts'
import { useGoogleMaps } from '../../apps/googleMaps/service'
import { Injectable } from '../../base/decorators'
import { IncyclistService } from '../../base/service'
import { Singleton } from '../../base/types'
import { useUserSettings } from '../../settings/service'
import {
    RideViewDeviceOption, RideViewNoticeActionId, RideViewOwnKeyOption, RideViewRestriction,
    RideViewRestrictionDialogProps, RideViewRestrictionNoticeProps, RideViewRestrictionStartProps
} from './types'

// English-only for now - no i18n system exists yet. Which text the rider sees is a WHAT decision,
// so it lives here in services and not in the apps (precedent: UNAVAILABLE_MESSAGES).
const HINT_KEY = 'hints.simulatedRideView'
const DIALOG_TITLE = 'Street View in simulated rides'
const DIALOG_BODY = 'Street View and Satellite View use Google Maps, and Google charges Incyclist for every ride that uses them. To keep Incyclist free, these views come with rides on a connected device. A simulated ride shows the Map instead.'
const DEVICE_TEXT = 'Connect your smart trainer, power meter or speed sensor before you start. Street View then works as usual.'
const DEVICE_TEXT_MOBILE = 'To get Street View: connect your smart trainer, power meter or speed sensor before you start.'
const OWN_KEY_TEXT = `With your own key, Street View and Satellite View also work in simulated rides. ${MAPS_KEY_TEXTS.billing}`
const VIEW_NAMES = { sv: 'Street View', sat: 'Satellite View' }

type NoticeState = 'inactive' | 'armed' | 'due' | 'acknowledged' | 'closed'

/**
 * Knows whether the ride view of the running ride is limited to the Map, and owns everything
 * that explains that limitation to the rider: the one-time notice, the explanation dialog and
 * the "remind me" setting.
 *
 * This is a leaf service on purpose: it must not import from the ride display/route modules,
 * because the settings display service depends on it.
 */
@Singleton
export class RideViewRestrictionService extends IncyclistService {

    protected restriction?: RideViewRestriction
    protected noticeState: NoticeState = 'inactive'
    protected noticeId = 0

    constructor() {
        super('RideViewRestriction')
    }

    /**
     * Evaluates the restriction for a ride that is about to start. The result stays constant
     * for the whole ride.
     */
    beginRide(props: RideViewRestrictionStartProps): void {
        try {
            this.restriction = undefined
            this.noticeState = 'inactive'
            this.noticeId++

            if (props.simulated && !this.getGoogleMaps().hasActivePersonalApiKey()) {
                this.restriction = { cause: 'simulation', preferredView: props.preferredView }
                if (this.isNoticeWanted(this.restriction))
                    this.noticeState = 'armed'
            }
            this.logEvent({ message: 'ride view restriction', restricted: this.restriction !== undefined, noticeState: this.noticeState })
        }
        catch (err) {
            this.logError(err, 'beginRide')
        }
        this.emit('changed')
    }

    /** The start overlay has closed: the notice may now be shown */
    onRideStarted(): void {
        if (this.noticeState !== 'armed')
            return
        this.noticeState = 'due'
        this.emit('changed')
    }

    /** The ride has ended */
    endRide(): void {
        this.restriction = undefined
        this.noticeState = 'inactive'
        this.emit('changed')
    }

    /** The restriction of the running ride, undefined if there is none */
    getActiveRestriction(): RideViewRestriction | undefined {
        return this.restriction
    }

    /**
     * The notice to be shown right now. Reading does not consume it: the app reports back with
     * `onNoticeAction()` / `onNoticeClosed()`.
     */
    getNotice(): RideViewRestrictionNoticeProps | undefined {
        const id = this.noticeId

        if (this.noticeState === 'due' && this.restriction) {
            const view = VIEW_NAMES[this.restriction.preferredView]
            return {
                id, state: 'message',
                text: `${view} isn't available in simulated rides. Showing the Map instead.`,
                actions: [
                    { id: 'how-to', label: `How to get ${view}` },
                    { id: 'dont-show-again', label: "Don't show this again" },
                ]
            }
        }
        if (this.noticeState === 'acknowledged') {
            return {
                id, state: 'acknowledged',
                actions: [{ id: 'change-this', label: "We won't show this again. Change this" }]
            }
        }
        return undefined
    }

    /**
     * The rider chose one of the notice's actions. 'how-to' and 'change-this' close the notice,
     * the caller is expected to open the explanation dialog.
     */
    onNoticeAction(id: RideViewNoticeActionId): void {
        if (id === 'dont-show-again') {
            this.setReminderEnabled(false)
            if (this.noticeState === 'due')
                this.noticeState = 'acknowledged'
        }
        else if (this.noticeState === 'due' || this.noticeState === 'acknowledged') {
            this.noticeState = 'closed'
        }
        this.emit('changed')
    }

    /** The notice was closed by the rider (✕) or timed out */
    onNoticeClosed(): void {
        if (this.noticeState !== 'due' && this.noticeState !== 'acknowledged')
            return
        this.noticeState = 'closed'
        this.emit('changed')
    }

    /** Is the notice shown in simulated rides? */
    isReminderEnabled(): boolean {
        return this.getUserSettings().get(HINT_KEY, false) !== true
    }

    /** Switches the notice on or off for all following simulated rides */
    setReminderEnabled(enabled: boolean): void {
        try {
            this.getUserSettings().set(HINT_KEY, !enabled)
        }
        catch (err) {
            this.logError(err, 'setReminderEnabled')
        }
    }

    /**
     * Content of the explanation dialog.
     *
     * @param props.inRide - a ride is running, so it can be discarded
     */
    getDialogProps(props: { inRide?: boolean } = {}): RideViewRestrictionDialogProps {
        const options: RideViewRestrictionDialogProps['options'] = [this.getDeviceOption(props.inRide === true)]
        if (!this.isMobile())
            options.push(this.getOwnKeyOption())

        const dialog: RideViewRestrictionDialogProps = { title: DIALOG_TITLE, body: DIALOG_BODY, options }
        if (this.restriction)
            dialog.reminder = { label: 'Remind me in simulated rides', checked: this.isReminderEnabled() }
        return dialog
    }

    protected isNoticeWanted(restriction: RideViewRestriction): boolean {
        return (restriction.preferredView === 'sv' || restriction.preferredView === 'sat') && this.isReminderEnabled()
    }

    protected getDeviceOption(inRide: boolean): RideViewDeviceOption {
        const mobile = this.isMobile()
        const option: RideViewDeviceOption = {
            id: 'device',
            text: mobile ? DEVICE_TEXT_MOBILE : DEVICE_TEXT,
        }
        if (!mobile)
            option.heading = 'Ride with a device'
        if (inRide) {
            option.discard = {
                label: 'Discard ride and connect a device',
                confirm: { question: 'Discard this simulated ride?', confirmLabel: 'Discard and connect', cancelLabel: 'Keep riding' }
            }
        }
        return option
    }

    protected getOwnKeyOption(): RideViewOwnKeyOption {
        const option: RideViewOwnKeyOption = {
            id: 'own-key',
            heading: 'Or use your own Google Maps API key',
            text: OWN_KEY_TEXT,
            helpLink: { label: MAPS_KEY_TEXTS.helpLabel, url: MAPS_KEY_HELP_URL },
        }
        if (this.getGoogleMaps().isPersonalApiKeyPendingRestart())
            option.pendingRestart = { text: MAPS_KEY_TEXTS.pendingRestart }
        else
            option.addKey = { label: 'Add my key' }
        return option
    }

    protected isMobile(): boolean {
        return this.getBindings()?.appInfo?.getChannel() === 'mobile'
    }

    @Injectable
    protected getUserSettings() {
        return useUserSettings()
    }

    @Injectable
    protected getGoogleMaps() {
        return useGoogleMaps()
    }

    @Injectable
    // istanbul ignore next
    protected getBindings() {
        return getBindings()
    }
}

export const useRideViewRestriction = () => new RideViewRestrictionService()
