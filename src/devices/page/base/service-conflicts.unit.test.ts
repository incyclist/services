/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'node:events'
import { AdapterFactory, IncyclistCapability, SerialPortProvider } from 'incyclist-devices'

import { Inject } from '../../../base/decorators/Injection'
import { DeviceConfigurationService, ExtendedIncyclistCapability } from '../../configuration'
import { DevicePairingService } from '../../pairing'
import { DesktopPairingPageService } from '../desktop/service'
import { DevicesPageService } from '../mobile/service'

// Conflicts on the Pairing page: the card of a device found by the search, when it shows, what a pick
// elsewhere does to it, and the second step of a pick in the Resistance list. The page decides all
// of it; the UI renders `pendingConflict` and `deviceSelection.conflictStep` as given. The pairing
// and configuration services are real; ride and access are fakes.

const Trainer = (id: string) => ({ interface: 'ble', name: `trainer-${id}`, address: id, protocol: 'fm' })
const PowerMeter = (id: string) => ({ interface: 'ble', name: `pwr-${id}`, address: id, protocol: 'cp' })
const HeartRateMonitor = (id: string) => ({ interface: 'ble', name: `hrm-${id}`, address: id, protocol: 'hr' })

const ALL_CAPABILITIES: ExtendedIncyclistCapability[] = [
    IncyclistCapability.Control, IncyclistCapability.Power, IncyclistCapability.Cadence,
    IncyclistCapability.Speed, IncyclistCapability.HeartRate, IncyclistCapability.AppControl
]
const { Control, Power, Speed, Cadence, HeartRate } = IncyclistCapability

class FakeRide extends EventEmitter {
    startAdapters = jest.fn().mockResolvedValue(true)
    stop = jest.fn().mockResolvedValue(true)
    stopDevices = jest.fn().mockResolvedValue(undefined)
    cancelStart = jest.fn().mockResolvedValue(true)
    lazyInit = jest.fn().mockResolvedValue(true)
    waitForPreviousStartToFinish = jest.fn().mockResolvedValue(true)
    onData = jest.fn()
}

class FakeAccess extends EventEmitter {
    scan = jest.fn().mockResolvedValue([])
    stopScan = jest.fn().mockResolvedValue(true)
    enrichWithAccessState = jest.fn((ifs: any[]) => (ifs ?? []).map(i => ({ ...i, state: 'connected', isScanning: false })))
}

describe.each([
    ['mobile', () => new DevicesPageService()],
    ['desktop', () => new DesktopPairingPageService()],
])('%s pairing page - conflicts', (_platform, create) => {

    let configuration: DeviceConfigurationService
    let pairing: DevicePairingService
    let page: DevicesPageService | DesktopPairingPageService
    let logEvent: jest.SpyInstance

    // a detection-triggered conflict settles (becomes visible) ~2s after the last one arrives.
    // Toggling fake timers just for that advance - rather than for the whole suite - keeps every
    // other real-timer-based helper here (pick()'s setImmediate flush, the helper's own timers)
    // unaffected.
    const CONFLICT_SETTLE_MS = 2000
    const detect = (settings: Record<string, unknown>): string => {
        jest.useFakeTimers()
        ;(pairing as any).onDeviceDetected(settings)
        jest.advanceTimersByTime(CONFLICT_SETTLE_MS)
        jest.useRealTimers()
        return configuration.getUdid(settings as any) as string
    }
    const events = (message: string) => logEvent.mock.calls.map(([e]) => e).filter((e: any) => e?.message === message)
    const selectedOf = (capability: IncyclistCapability) => configuration.getConfiguredSelection(capability)

    const props = () => page.getPageDisplayProperties()
    const card = () => props().pendingConflict
    const rowsOf = (step: any) => step?.rows.map((r: any) => r.capability).sort()
    const tile = (name: string) => [...props().capabilities!.top, ...props().capabilities!.bottom].find(t => t.capability === name)!

    // a pick in the open list, as the list's item does it; settles before the next look at the page
    const pick = async (udid: string, addAll?: boolean) => {
        (page as any).onDeviceSelected({ udid, name: udid }, addAll)
        await new Promise(done => setImmediate(done))
    }
    const openList = (capability: IncyclistCapability) => { (page as any).openDeviceSelection(capability) }
    const closeList = () => { (page as any).closeDeviceSelection() }

    // Speed and Cadence switched off, so each conflict below is about Power alone
    const onlyPowerConflicts = () => {
        configuration.disableCapability(Speed)
        configuration.disableCapability(Cadence)
    }

    beforeEach(async () => {
        SerialPortProvider.getInstance().getBinding = jest.fn().mockReturnValue({})

        configuration = new DeviceConfigurationService()
        configuration.settings = {
            devices: [],
            capabilities: ALL_CAPABILITIES.map(capability => ({ capability, devices: [], selected: undefined, disabled: false })),
            interfaces: [{ name: 'ble', enabled: true }],
        }
        configuration.adapters = {}
        configuration.inject('UserSettings', { set: jest.fn(), get: jest.fn(), save: jest.fn() } as any)

        pairing = new DevicePairingService({ configuration, access: new FakeAccess(), ride: new FakeRide() } as any)
        pairing.usage = 'page'
        await (pairing as any).loadConfiguration()
        ;(pairing as any).initConfigHandlers()
        logEvent = jest.spyOn(pairing as any, 'logEvent')
        // the list's own scan isn't what is looked at here
        jest.spyOn(pairing, 'startDeviceSelection').mockImplementation((capability: any) => ({ capability, devices: [] }))
        jest.spyOn(pairing, 'stopDeviceSelection').mockResolvedValue(undefined)

        Inject('DeviceConfiguration', configuration)
        Inject('DevicePairing', pairing)
        Inject('AppState', { setState: jest.fn(), getState: jest.fn(), getPersistedState: jest.fn() })
        Inject('DeviceAccess', { enrichWithAccessState: jest.fn((i: any) => i) })
        Inject('Bindings', { ui: { openPage: jest.fn() } })
        Inject('PairingVisitTracker', { openVisit: jest.fn(), closeVisit: jest.fn(), setExitFields: jest.fn(), onBackground: jest.fn(), onForeground: jest.fn() })

        page = create()
        ;(page as any).stateMachine = { state: 'Idle', selectState: 'Closed', start: jest.fn(), stop: jest.fn(), pause: jest.fn(), resume: jest.fn(), onDeviceSelectionOpened: jest.fn(), onDeviceSelectionClosed: jest.fn() }
        ;(page as any).moveTo = jest.fn()
        ;(page as any).openVisit()
    })

    afterEach(async () => {
        (page as any).closeVisit('skip')
        ;(page as any).reset()
        await pairing.stop([], true)
        pairing.removeAllListeners()
        pairing.reset()
        configuration.removeAllListeners()
        configuration.reset()
        ;['DeviceConfiguration', 'DevicePairing', 'AppState', 'DeviceAccess', 'Bindings', 'PairingVisitTracker'].forEach(name => Inject(name, null))
        AdapterFactory.reset()
        jest.clearAllMocks()
    })

    afterAll(() => {
        (SerialPortProvider as any)._instance = undefined
    })

    describe('the card of a device found by the search', () => {

        test('shows the conflict with Keep picked in every row', () => {
            const pwr = detect(PowerMeter('1'))
            const trainer = detect(Trainer('2'))

            const shown = card()!
            expect(shown).toMatchObject({
                id: pairing.getPendingConflicts()[0].id, origin: 'detection', deviceName: expect.any(String), queued: 0,
                title: `${shown.deviceName} can also measure more`,
                subline: { full: `We just found your ${shown.deviceName}. Nothing changes until you choose. Resistance was free and now uses ${shown.deviceName}.`, short: `Just found ${shown.deviceName}. Nothing changes until you choose.` },
            })
            expect(shown.queuedText).toBeUndefined()
            expect(rowsOf(shown)).toEqual([Cadence, Power, Speed].sort())
            const power = shown.rows.find(r => r.capability === Power)!
            expect(power).toMatchObject({ capabilityTitle: 'Power', choice: 'keep', keepLabel: `Keep ${power.currentName}`, replaceLabel: `Use ${shown.deviceName}` })
            expect(selectedOf(Power)).toBe(pwr)
            expect(trainer).toBeDefined()
        })

        test('Done applies the choices, and the card goes', async () => {
            detect(PowerMeter('1'))
            const trainer = detect(Trainer('2'))

            card()!.onChoice('power', 'replace')
            expect(card()!.rows.find(r => r.capability === Power)!.choice).toBe('replace')
            card()!.onDone()
            await new Promise(done => setImmediate(done))

            expect(selectedOf(Power)).toBe(trainer)
            expect(card()).toBeUndefined()
            expect(events('device select conflict resolved')).toEqual([expect.objectContaining({ origin: 'detection', resolution: 'done', replacedCount: 1 })])
        })

        test('a tap outside the dialog (onDismiss) applies the choices made so far, same as Done', async () => {
            detect(PowerMeter('1'))
            const trainer = detect(Trainer('2'))

            card()!.onChoice('power', 'replace')
            card()!.onDismiss()
            await new Promise(done => setImmediate(done))

            expect(selectedOf(Power)).toBe(trainer)
            expect(card()).toBeUndefined()
            expect(events('device select conflict resolved')).toEqual([expect.objectContaining({ resolution: 'dismissed', replacedCount: 1 })])
        })

        test('onDismiss with no choice made keeps every current device', () => {
            const pwr = detect(PowerMeter('1'))
            detect(Trainer('2'))

            card()!.onDismiss()

            expect(selectedOf(Power)).toBe(pwr)
            expect(card()).toBeUndefined()
            expect(events('device select conflict resolved')).toEqual([expect.objectContaining({ resolution: 'dismissed', replacedCount: 0 })])
        })
    })

    describe('while the panel or a device list is busy', () => {

        test('a conflict found while the helper is open waits for it to close, then shows with its own id', () => {
            // nothing to ride with yet, so the helper stays open
            detect(HeartRateMonitor('1'))
            props().helper!.onOpen()
            detect(HeartRateMonitor('2'))
            const [queued] = pairing.getPendingConflicts()

            expect(props().helper!.phase).toBe('open')
            expect(card()).toBeUndefined()
            expect(pairing.getPendingConflicts()).toHaveLength(1)

            props().helper!.onDismiss()
            expect(card()?.id).toBe(queued.id)
        })

        test('while the helper says the row is ready, the card still waits, and shows once the helper has gone', () => {
            jest.useFakeTimers()
            try {
                // bypasses the shared detect() helper, which settles (and briefly uses real timers)
                // on its own - this test manages the fake clock itself, since the helper's own
                // resolved-to-hidden transition shares the same ~2s window
                const rawDetect = (settings: Record<string, unknown>) => { (pairing as any).onDeviceDetected(settings) }

                rawDetect(PowerMeter('1'))
                props().helper!.onOpen()
                expect(props().helper!.phase).toBe('resolved')
                rawDetect(Trainer('2'))

                expect(card()).toBeUndefined()
                jest.advanceTimersByTime(2000)
                expect(props().helper!.phase).toBe('hidden')
                expect(card()?.id).toBe(pairing.getPendingConflicts()[0].id)
            }
            finally {
                jest.useRealTimers()
            }
        })

        test('a conflict found while a device list is open waits for the list to close, then shows with its own id', () => {
            detect(PowerMeter('1'))
            openList(HeartRate)
            detect(Trainer('2'))
            const [queued] = pairing.getPendingConflicts()

            expect(card()).toBeUndefined()
            expect(pairing.getPendingConflicts()).toHaveLength(1)

            closeList()
            expect(card()?.id).toBe(queued.id)
        })
    })

    describe('a selection changed somewhere else first', () => {

        test('picking the found device in the conflicting slot\'s own list settles it: no card, logged once as superseded', async () => {
            onlyPowerConflicts()
            detect(PowerMeter('1'))
            const trainer = detect(Trainer('2'))
            expect(rowsOf(card())).toEqual([Power])

            openList(Power)
            await pick(trainer)

            expect(selectedOf(Power)).toBe(trainer)
            expect(card()).toBeUndefined()
            expect(pairing.getPendingConflicts()).toEqual([])
            expect(events('device select conflict resolved')).toEqual([
                expect.objectContaining({ origin: 'detection', resolution: 'superseded', replacedCount: 0 })
            ])
            expect(events('device select conflict stale')).toEqual([])
        })

        test('with two rows, settling one leaves the card with the other row only', async () => {
            configuration.disableCapability(Cadence)
            detect(PowerMeter('1'))
            const trainer = detect(Trainer('2'))
            expect(rowsOf(card())).toEqual([Power, Speed].sort())

            openList(Power)
            await pick(trainer)

            expect(rowsOf(card())).toEqual([Speed])
            expect(events('device select conflict resolved')).toEqual([])
        })

        test('switching the conflicting slot off drops its row', async () => {
            configuration.disableCapability(Cadence)
            detect(PowerMeter('1'))
            detect(Trainer('2'))

            tile('power').onUnselect!()
            await new Promise(done => setImmediate(done))

            expect(rowsOf(card())).toEqual([Speed])
        })

        test('deleting the device in the conflicting slot drops its row, and the slot stays empty', async () => {
            configuration.disableCapability(Cadence)
            const pwr = detect(PowerMeter('1'))
            detect(Trainer('2'))

            openList(Power)
            ;(page as any).onDeviceDelete({ udid: pwr, name: pwr })
            await new Promise(done => setImmediate(done))
            closeList()

            expect(rowsOf(card())).toEqual([Speed])
            expect(selectedOf(Power)).toBeFalsy()
        })

        test('"1 more" counts the conflicts behind the card, after the settled ones are gone', async () => {
            onlyPowerConflicts()
            detect(Trainer('1'))
            detect(PowerMeter('2'))
            const pwr3 = detect(PowerMeter('3'))
            const pwr4 = detect(PowerMeter('4'))
            const head = pairing.getPendingConflicts()[0].id

            expect(card()).toMatchObject({ id: head, queued: 2, queuedText: '2 more' })

            openList(Power)
            await pick(pwr3)
            expect(card()).toMatchObject({ id: head, queued: 1, queuedText: '1 more' })

            openList(Power)
            await pick(pwr4)
            expect(card()).toMatchObject({ id: head, queued: 0 })
            expect(card()!.queuedText).toBeUndefined()
        })
    })

    describe('a pick in the Resistance list', () => {

        // a power meter holds Power, Speed and Cadence, the trainer is known but not selected
        const prepare = () => {
            const pwr = detect(PowerMeter('1'))
            const trainer = configuration.add(Trainer('2'))
            configuration.unselect(Control)
            return { pwr, trainer }
        }

        test('that takes slots held by another device shows the conflict step in the list, with Keep picked', async () => {
            const { pwr, trainer } = prepare()
            openList(Control)

            await pick(trainer)

            const step = props().deviceSelection!.conflictStep!
            expect(step).toMatchObject({ origin: 'manual', queued: 0, subline: { full: 'Choose which device to use for each.', short: 'Choose which device to use for each.' } })
            expect(rowsOf(step)).toEqual([Cadence, Power, Speed].sort())
            step.rows.forEach(r => expect(r.choice).toBe('keep'))
            expect(selectedOf(Control)).toBeFalsy()
            expect(selectedOf(Power)).toBe(pwr)
            expect(events('device select conflict shown')).toEqual([expect.objectContaining({ origin: 'manual', conflictCount: 3 })])
        })

        test('Done selects the trainer, takes only the chosen slots, and closes the list', async () => {
            const { pwr, trainer } = prepare()
            openList(Control)
            await pick(trainer)

            props().deviceSelection!.conflictStep!.onChoice('speed', 'replace')
            props().deviceSelection!.conflictStep!.onDone()
            await new Promise(done => setImmediate(done))

            expect(selectedOf(Control)).toBe(trainer)
            expect(selectedOf(Speed)).toBe(trainer)
            expect(selectedOf(Power)).toBe(pwr)
            expect(props().deviceSelection).toBeUndefined()
            expect(events('device select conflict resolved')).toEqual([expect.objectContaining({ origin: 'manual', resolution: 'done', replacedCount: 1 })])
        })

        test('closing the list with the step open applies the choices made so far', async () => {
            const { pwr, trainer } = prepare()
            openList(Control)
            await pick(trainer)

            props().deviceSelection!.onClose()
            await new Promise(done => setImmediate(done))

            expect(selectedOf(Control)).toBe(trainer)
            expect(selectedOf(Power)).toBe(pwr)
            expect(events('device select conflict resolved')).toEqual([expect.objectContaining({ origin: 'manual', resolution: 'dismissed' })])
        })

        test('without conflicts, the pick fills the free slots and the list closes at once', async () => {
            const trainer = configuration.add(Trainer('2'))
            configuration.unselect(Control)
            openList(Control)

            await pick(trainer)

            expect(selectedOf(Control)).toBe(trainer)
            expect(selectedOf(Power)).toBe(trainer)
            expect(props().deviceSelection).toBeUndefined()
            expect(events('device select conflict shown')).toEqual([])
        })

        test('the deprecated "for all" switch still works as before', async () => {
            const { trainer } = prepare()
            openList(Control)

            await pick(trainer, true)

            expect(selectedOf(Power)).toBe(trainer)
            expect(events('device select conflict shown')).toEqual([])
        })

        test('a pick in another list never asks', async () => {
            const { trainer } = prepare()
            openList(Power)

            await pick(trainer)

            expect(selectedOf(Power)).toBe(trainer)
            expect(events('device select conflict shown')).toEqual([])
        })

        test('the list is a device list: no card shows over it', async () => {
            const { trainer } = prepare()
            detect(Trainer('3'))
            openList(Control)
            await pick(trainer)

            expect(props().deviceSelection!.conflictStep).toBeDefined()
            expect(card()).toBeUndefined()
        })
    })
})
