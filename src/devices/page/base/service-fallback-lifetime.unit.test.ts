/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'node:events'
import { AdapterFactory, IncyclistCapability, SerialPortProvider } from 'incyclist-devices'

import { Inject } from '../../../base/decorators/Injection'
import { DeviceConfigurationService, ExtendedIncyclistCapability } from '../../configuration'
import { DevicePairingService } from '../../pairing'
import { DeviceRideService } from '../../ride'
import { DevicesPageService } from '../mobile/service'

// How long riding without the trainer lasts: from the rider's choice on the Pairing page, through the
// ride and any number of later rides, until the Pairing page is opened again. The configuration, the
// pairing service and the ride service are real; nothing is connected to hardware.

const Trainer = (id: string) => ({ interface: 'ble', name: `trainer-${id}`, address: id, protocol: 'fm' })
const PowerMeter = (id: string) => ({ interface: 'ble', name: `pwr-${id}`, address: id, protocol: 'cp' })

const ALL_CAPABILITIES: ExtendedIncyclistCapability[] = [
    IncyclistCapability.Control, IncyclistCapability.Power, IncyclistCapability.Cadence,
    IncyclistCapability.Speed, IncyclistCapability.HeartRate, IncyclistCapability.AppControl
]

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

describe('riding without the trainer: how long it lasts', () => {

    let configuration: DeviceConfigurationService
    let pairing: DevicePairingService
    let ride: DeviceRideService
    let page: DevicesPageService
    let trainer: string
    let powerMeter: string

    const trainerExcluded = () => configuration.getExclusions().some(e => e.udid === trainer)
    // the adapters a ride starts with, as the ride service picks them
    const rideAdapters = () => ((ride as any).getRideAdapters() as Array<{ udid: string }>).map(ai => ai.udid).sort()
    const controlDevice = () => ride.getControlAdapter()?.udid

    // what the pairing service tells the page: the trainer can't be reached, the power meter is connected
    const emitPairingState = (trainerState: string) => {
        const excluded = (capability: string, udid?: string) => {
            const e = configuration.getExclusions().find(x => x.capability === capability && x.udid === udid)
            return e ? { reason: e.reason, scope: e.scope } : undefined
        }
        const capability = (name: string, connectState: string) => {
            const selected = configuration.getConfiguredSelection(name as IncyclistCapability)
            return { capability: name, selected, interface: 'ble', disabled: false, devices: [], deviceName: selected, deviceNames: selected, connectState, excluded: excluded(name, selected) }
        }
        const state = {
            capabilities: [capability('control', trainerState), capability('power', 'connected'), capability('speed', trainerState)],
            interfaces: [{ name: 'ble', enabled: true, state: 'connected' }],
            canStartRide: true,
        }
        ;(page as any).onPairingState(state)
        jest.spyOn(pairing, 'getState').mockReturnValue(state as any)
        page.getPageDisplayProperties()
    }

    beforeAll(() => {
        jest.useFakeTimers()
        SerialPortProvider.getInstance().getBinding = jest.fn().mockReturnValue({})

        configuration = new DeviceConfigurationService()
        configuration.settings = {
            devices: [],
            capabilities: ALL_CAPABILITIES.map(capability => ({ capability, devices: [], selected: undefined, disabled: false })),
            interfaces: [{ name: 'ble', enabled: true }],
        }
        configuration.adapters = {}
        configuration.inject('UserSettings', { set: jest.fn(), get: jest.fn(), save: jest.fn() } as any)
        trainer = configuration.add(Trainer('1'))
        powerMeter = configuration.add(PowerMeter('2'))
        configuration.select(powerMeter, IncyclistCapability.Power)

        pairing = new DevicePairingService({ configuration, access: new FakeAccess(), ride: new FakeRide() } as any)

        Inject('DeviceConfiguration', configuration)
        Inject('DevicePairing', pairing)
        Inject('AppState', { setState: jest.fn(), getState: jest.fn(), getPersistedState: jest.fn() })
        Inject('DeviceAccess', { enrichWithAccessState: jest.fn((i: any) => i) })
        Inject('Bindings', { ui: { openPage: jest.fn() } })
        Inject('PairingVisitTracker', { openVisit: jest.fn(), closeVisit: jest.fn(), setExitFields: jest.fn(), onBackground: jest.fn(), onForeground: jest.fn() })

        ride = new DeviceRideService()
        page = new DevicesPageService()
        ;(page as any).stateMachine = { state: 'Idle', start: jest.fn(), stop: jest.fn(), pause: jest.fn().mockResolvedValue(undefined), resume: jest.fn() }
        ;(page as any).moveTo = jest.fn()
        // resuming restarts pairing, which isn't what is looked at here
        jest.spyOn(page as any, 'start').mockResolvedValue(undefined)

        // the trainer's attempt failed on this visit, with the power meter connected
        ;(page as any).openVisit()
        emitPairingState('connecting')
        emitPairingState('failed')
    })

    afterAll(() => {
        (page as any).guidance.closeVisit()
        ;(page as any).reset()
        ;(ride as any).reset?.()
        pairing.reset()
        configuration.reset()
        ;['DeviceConfiguration', 'DevicePairing', 'AppState', 'DeviceAccess', 'Bindings', 'PairingVisitTracker'].forEach(name => Inject(name, null))
        AdapterFactory.reset()
        jest.useRealTimers()
        jest.clearAllMocks()
        ;(SerialPortProvider as any)._instance = undefined
    })

    // the rows run in order and each one continues from the state the one before it left
    type Expected = { trainerExcluded: boolean, rideAdapters?: () => string[], controlDevice?: () => string }
    const rows: Array<[string, () => unknown, Expected]> = [
        ['the rider chooses to ride on the power meter on the Pairing page', () => { (page as any).onChooseFallback() },
            { trainerExcluded: true }],
        ['the page goes to the background and comes back', async () => { await page.pausePage(); await page.resumePage() },
            { trainerExcluded: true }],
        ['OK hands the devices over to the ride: the ride starts on the power meter', () => { (page as any).onOK() },
            { trainerExcluded: true, rideAdapters: () => [powerMeter], controlDevice: () => powerMeter }],
        ['the ride ends', async () => { await ride.stop() },
            { trainerExcluded: true }],
        ['a later ride starts from a content page: still on the power meter', () => undefined,
            { trainerExcluded: true, rideAdapters: () => [powerMeter], controlDevice: () => powerMeter }],
        ['that ride ends too', async () => { await ride.stop() },
            { trainerExcluded: true }],
        ['the rider opens the Pairing page again: the trainer is back', () => { (page as any).openVisit() },
            { trainerExcluded: false, rideAdapters: () => [trainer, powerMeter].sort(), controlDevice: () => trainer }],
    ]

    it.each(rows)('%s', async (_name, action, expected) => {
        await action()
        await jest.advanceTimersByTimeAsync(0)

        expect(trainerExcluded()).toBe(expected.trainerExcluded)
        if (expected.rideAdapters) {
            expect(rideAdapters()).toEqual(expected.rideAdapters())
            expect(controlDevice()).toBe(expected.controlDevice?.())
            await ride.stop()
        }
    })
})
