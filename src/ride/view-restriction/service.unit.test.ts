import { Inject } from '../../base/decorators'
import { MAPS_KEY_HELP_URL } from '../../apps/googleMaps/consts'
import { RideViewRestrictionService } from './service'
import { RideViewOwnKeyOption, RideViewDeviceOption } from './types'

describe('RideViewRestrictionService', () => {

    let service: RideViewRestrictionService
    let settingsValues: Record<string, unknown>
    let channel: string

    const UserSettingsMock = {
        get: jest.fn((key: string, def: unknown) => settingsValues[key] ?? def),
        set: jest.fn((key: string, value: unknown) => { settingsValues[key] = value }),
    }
    const GoogleMapsMock = {
        hasActivePersonalApiKey: jest.fn(),
        isPersonalApiKeyPendingRestart: jest.fn(),
    }
    const BindingsMock = {
        appInfo: { getChannel: jest.fn(() => channel) }
    }

    const begin = (simulated = true, preferredView: 'sv' | 'sat' | 'map' = 'sv') => {
        service.beginRide({ simulated, preferredView })
    }

    beforeEach(() => {
        settingsValues = {}
        channel = 'electron'
        GoogleMapsMock.hasActivePersonalApiKey.mockReturnValue(false)
        GoogleMapsMock.isPersonalApiKeyPendingRestart.mockReturnValue(false)
        service = new RideViewRestrictionService()
        Inject('UserSettings', UserSettingsMock)
        Inject('GoogleMaps', GoogleMapsMock)
        Inject('Bindings', BindingsMock)
    })

    afterEach(() => {
        (service as unknown as { reset: () => void }).reset()
        Inject('UserSettings', null)
        Inject('GoogleMaps', null)
        Inject('Bindings', null)
        jest.clearAllMocks()
    })

    describe('beginRide / getActiveRestriction', () => {
        test.each([
            // simulated, key, expected restricted
            [true, false, true],
            [true, true, false],
            [false, false, false],
            [false, true, false],
        ])('simulated=%s activeKey=%s -> restricted=%s', (simulated, key, restricted) => {
            GoogleMapsMock.hasActivePersonalApiKey.mockReturnValue(key)
            begin(simulated)
            expect(service.getActiveRestriction()).toEqual(restricted ? { cause: 'simulation', preferredView: 'sv' } : undefined)
        })

        test('restriction stays constant when the key changes during the ride', () => {
            begin()
            GoogleMapsMock.hasActivePersonalApiKey.mockReturnValue(true)
            expect(service.getActiveRestriction()).toBeDefined()
        })

        test('endRide clears the restriction', () => {
            begin()
            service.endRide()
            expect(service.getActiveRestriction()).toBeUndefined()
            expect(service.getNotice()).toBeUndefined()
        })

        test('emits changed', () => {
            const onChanged = jest.fn()
            service.on('changed', onChanged)
            begin()
            expect(onChanged).toHaveBeenCalled()
        })
    })

    describe('notice', () => {
        test('not shown before the ride has started', () => {
            begin()
            expect(service.getNotice()).toBeUndefined()
        })

        test('shown after the ride has started', () => {
            begin()
            service.onRideStarted()
            const notice = service.getNotice()
            expect(notice).toMatchObject({
                state: 'message',
                text: "Street View isn't available in simulated rides. Showing the Map instead.",
                actions: [
                    { id: 'how-to', label: 'How to get Street View' },
                    { id: 'dont-show-again', label: "Don't show this again" },
                ]
            })
            expect(typeof notice.id).toBe('number')
        })

        test('uses the name of the satellite view', () => {
            begin(true, 'sat')
            service.onRideStarted()
            expect(service.getNotice().text).toBe("Satellite View isn't available in simulated rides. Showing the Map instead.")
            expect(service.getNotice().actions[0].label).toBe('How to get Satellite View')
        })

        test('reading it does not consume it', () => {
            begin()
            service.onRideStarted()
            expect(service.getNotice()).toEqual(service.getNotice())
            expect(service.getNotice()).toBeDefined()
        })

        test.each([
            ['preferred view is map', true, 'map', {}],
            ['not simulated', false, 'sv', {}],
            ['reminder switched off', true, 'sv', { 'hints.simulatedRideView': true }],
        ])('not shown if %s', (_name, simulated, view, settings) => {
            settingsValues = { ...settings }
            begin(simulated as boolean, view as 'sv' | 'map')
            service.onRideStarted()
            expect(service.getNotice()).toBeUndefined()
        })

        test('not shown if a personal key is active', () => {
            GoogleMapsMock.hasActivePersonalApiKey.mockReturnValue(true)
            begin()
            service.onRideStarted()
            expect(service.getNotice()).toBeUndefined()
        })

        test('id is stable within a ride and differs between rides', () => {
            begin()
            service.onRideStarted()
            const first = service.getNotice().id
            service.onNoticeAction('dont-show-again')
            expect(service.getNotice().id).toBe(first)

            service.endRide()
            settingsValues = {}
            begin()
            service.onRideStarted()
            expect(service.getNotice().id).not.toBe(first)
        })

        test('dont-show-again stores the setting and switches to the acknowledgement', () => {
            begin()
            service.onRideStarted()
            service.onNoticeAction('dont-show-again')

            expect(UserSettingsMock.set).toHaveBeenCalledWith('hints.simulatedRideView', true)
            expect(service.isReminderEnabled()).toBe(false)
            expect(service.getNotice()).toMatchObject({
                state: 'acknowledged',
                actions: [{ id: 'change-this', label: "We won't show this again. Change this" }]
            })
            expect(service.getNotice().text).toBeUndefined()
        })

        test('acknowledgement is shown even if the setting could not be written', () => {
            UserSettingsMock.set.mockImplementationOnce(() => { throw new Error('disk full') })
            begin()
            service.onRideStarted()
            service.onNoticeAction('dont-show-again')
            expect(service.getNotice()?.state).toBe('acknowledged')
        })

        test.each(['how-to', 'change-this'] as const)('%s closes the notice', (action) => {
            begin()
            service.onRideStarted()
            service.onNoticeAction(action)
            expect(service.getNotice()).toBeUndefined()
        })

        test('closing hides the notice and it never comes back in this ride', () => {
            begin()
            service.onRideStarted()
            service.onNoticeClosed()
            expect(service.getNotice()).toBeUndefined()
            service.onRideStarted()
            expect(service.getNotice()).toBeUndefined()
        })

        test('closing the acknowledgement hides it', () => {
            begin()
            service.onRideStarted()
            service.onNoticeAction('dont-show-again')
            service.onNoticeClosed()
            expect(service.getNotice()).toBeUndefined()
        })

        test('shows again in the next ride if only closed', () => {
            begin()
            service.onRideStarted()
            service.onNoticeClosed()
            service.endRide()
            begin()
            service.onRideStarted()
            expect(service.getNotice()).toBeDefined()
        })

        test('re-armed on a new ride after the reminder was switched on again', () => {
            begin()
            service.onRideStarted()
            service.onNoticeAction('dont-show-again')
            service.setReminderEnabled(true)
            service.endRide()
            begin()
            service.onRideStarted()
            expect(service.getNotice()?.state).toBe('message')
        })

        test('emits changed on every transition', () => {
            begin()
            const onChanged = jest.fn()
            service.on('changed', onChanged)
            service.onRideStarted()
            service.onNoticeAction('dont-show-again')
            service.onNoticeClosed()
            expect(onChanged).toHaveBeenCalledTimes(3)
        })
    })

    describe('reminder', () => {
        test('enabled by default', () => {
            expect(service.isReminderEnabled()).toBe(true)
        })

        test('setReminderEnabled(false) writes true to the hint', () => {
            service.setReminderEnabled(false)
            expect(UserSettingsMock.set).toHaveBeenCalledWith('hints.simulatedRideView', true)
        })

        test('setReminderEnabled(true) writes false to the hint', () => {
            service.setReminderEnabled(true)
            expect(UserSettingsMock.set).toHaveBeenCalledWith('hints.simulatedRideView', false)
            expect(service.isReminderEnabled()).toBe(true)
        })

        test('does not throw if the setting can not be written', () => {
            UserSettingsMock.set.mockImplementationOnce(() => { throw new Error('disk full') })
            expect(() => service.setReminderEnabled(false)).not.toThrow()
        })
    })

    describe('getDialogProps', () => {
        const findOwnKey = (opts) => opts.find(o => o.id === 'own-key') as RideViewOwnKeyOption
        const findDevice = (opts) => opts.find(o => o.id === 'device') as RideViewDeviceOption

        test('desktop in a ride', () => {
            begin()
            const props = service.getDialogProps({ inRide: true })

            expect(props.title).toBe('Street View in simulated rides')
            expect(props.body).toContain('Google charges Incyclist for every ride')

            const device = findDevice(props.options)
            expect(device.heading).toBe('Ride with a device')
            expect(device.discard).toEqual({
                label: 'Discard ride and connect a device',
                confirm: { question: 'Discard this simulated ride?', confirmLabel: 'Discard and connect', cancelLabel: 'Keep riding' }
            })

            const ownKey = findOwnKey(props.options)
            expect(ownKey.heading).toBe('Or use your own Google Maps API key')
            expect(ownKey.addKey).toEqual({ label: 'Add my key' })
            expect(ownKey.pendingRestart).toBeUndefined()
            expect(ownKey.helpLink).toEqual({ label: 'How to create a key', url: MAPS_KEY_HELP_URL })

            expect(props.reminder).toEqual({ label: 'Remind me in simulated rides', checked: true })
        })

        test('desktop outside a ride has no discard and no reminder', () => {
            const props = service.getDialogProps({ inRide: false })
            expect(findDevice(props.options).discard).toBeUndefined()
            expect(props.reminder).toBeUndefined()
            expect(findOwnKey(props.options)).toBeDefined()
        })

        test('desktop with a key saved this session', () => {
            GoogleMapsMock.isPersonalApiKeyPendingRestart.mockReturnValue(true)
            begin()
            const ownKey = findOwnKey(service.getDialogProps({ inRide: true }).options)
            expect(ownKey.addKey).toBeUndefined()
            expect(ownKey.pendingRestart).toEqual({ text: 'Saved. Restart Incyclist to use it.' })
        })

        test('reminder reflects the stored setting', () => {
            settingsValues['hints.simulatedRideView'] = true
            begin()
            expect(service.getDialogProps({ inRide: true }).reminder.checked).toBe(false)
        })

        test('mobile offers the device only', () => {
            channel = 'mobile'
            begin()
            const props = service.getDialogProps({ inRide: true })

            expect(props.options).toHaveLength(1)
            const device = findDevice(props.options)
            expect(device.heading).toBeUndefined()
            expect(device.text).toBe('To get Street View: connect your smart trainer, power meter or speed sensor before you start.')
            expect(device.discard).toBeDefined()
            expect(JSON.stringify(props)).not.toMatch(/key/i)
        })
    })
})
