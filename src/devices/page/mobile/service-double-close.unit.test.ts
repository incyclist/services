/* eslint-disable @typescript-eslint/no-explicit-any */
import { IncyclistCapability } from 'incyclist-devices'

import { Inject } from '../../../base/decorators/Injection'
import { IncyclistPageService } from '../../../base/pages'
import { DevicesPageService } from './service'

/**
 * Characterization of leaving the pairing page: every button exit closes the page twice, once from
 * moveTo() and once from the platform's unmount hook.
 *
 * Only the first close acts; the second one is ignored.
 */
describe('DevicesPageService: closing the page twice', () => {

    let service: DevicesPageService

    const pairing = {
        getState: jest.fn(),
        start: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
        prepareStart: jest.fn().mockResolvedValue(undefined),
        setReadyToStart: jest.fn(),
        isReadyToStart: jest.fn().mockReturnValue(false),
        setVisitOpen: jest.fn(),
        usage: undefined,
    }

    const appState = {
        setState: jest.fn(),
        getState: jest.fn(),
        getPersistedState: jest.fn(),
    }

    const tracker = {
        openVisit: jest.fn(),
        closeVisit: jest.fn(),
        setExitFields: jest.fn(),
        onBackground: jest.fn(),
        onForeground: jest.fn(),
    }

    const ui = { openPage: jest.fn(), quit: jest.fn() }

    const stateMachine = {
        state: 'Idle',
        selectState: 'Closed',
        start: jest.fn(),
        stop: jest.fn(),
        pause: jest.fn().mockResolvedValue(undefined),
        resume: jest.fn(),
        onDeviceSelectionOpened: jest.fn(),
        onDeviceSelectionClosed: jest.fn(),
    }

    beforeEach(() => {
        Inject('DevicePairing', pairing)
        Inject('AppState', appState)
        Inject('DeviceConfiguration', { getSimulatorAdapterId: jest.fn().mockReturnValue('Simulator') })
        Inject('Bindings', { ui })
        Inject('PairingVisitTracker', tracker)

        pairing.getState.mockReturnValue({
            capabilities: [{ capability: IncyclistCapability.AppControl, devices: [], selected: undefined }],
            interfaces: [],
            canStartRide: false,
        })
        appState.getPersistedState.mockReturnValue('routes')
        stateMachine.state = 'Idle'

        service = new DevicesPageService()
        ;(service as any).stateMachine = stateMachine
    })

    afterEach(() => {
        ;(service as any).reset?.()
        delete (IncyclistPageService as any).currentPage
        Inject('DevicePairing', null)
        Inject('AppState', null)
        Inject('DeviceConfiguration', null)
        Inject('Bindings', null)
        Inject('PairingVisitTracker', null)
        jest.clearAllMocks()
    })

    // what the rider's button does (first close, from moveTo()), then what the platform's unmount hook does
    const leaveWith = (button: 'onOK' | 'onSimulate' | 'onSkip') => {
        service.openPage()
        ;(service as any)[button]()
        service.closePage()
    }

    describe('OK', () => {

        test('hands the adapters to the ride exactly once', () => {
            leaveWith('onOK')

            expect(pairing.prepareStart).toHaveBeenCalledTimes(1)
            expect(pairing.setReadyToStart).toHaveBeenCalledTimes(1)
        })

        test('the second close does not stop the devices that were handed to the ride', () => {
            leaveWith('onOK')

            expect(pairing.stop).not.toHaveBeenCalled()
        })

        test('the first close alone keeps the hand-off intact', () => {
            service.openPage()
            ;(service as any).onOK()

            expect(pairing.stop).not.toHaveBeenCalled()
        })
    })

    describe('Simulate', () => {

        test('hands over only the simulator, once', () => {
            leaveWith('onSimulate')

            expect(pairing.prepareStart).toHaveBeenCalledTimes(1)
            expect(pairing.prepareStart).toHaveBeenCalledWith(['Simulator'])
        })

        test('the second close does not stop the simulator hand-off', () => {
            leaveWith('onSimulate')

            expect(pairing.stop).not.toHaveBeenCalled()
        })
    })

    describe('Skip', () => {

        test('stops the devices and the state machine once', () => {
            leaveWith('onSkip')

            expect(pairing.stop).toHaveBeenCalledTimes(1)
            expect(stateMachine.stop).toHaveBeenCalledTimes(1)
        })
    })

    describe('registration of the current page', () => {

        test('the second close leaves the next page registered', () => {
            service.openPage()
            ;(service as any).onSkip()
            const nextPage = { name: 'routes' }
            ;(IncyclistPageService as any).currentPage = nextPage

            service.closePage()

            expect((IncyclistPageService as any).currentPage).toBe(nextPage)
        })
    })
})
