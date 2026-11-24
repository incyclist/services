/* eslint-disable @typescript-eslint/no-explicit-any */
import { IncyclistCapability } from 'incyclist-devices'

import { Inject } from '../../../base/decorators/Injection'
import { IncyclistPageService } from '../../../base/pages'
import { DevicesPageService } from './service'

/**
 * Characterization of leaving the pairing page: every button exit closes the page twice, once from
 * moveTo() and once from the platform's unmount hook.
 *
 * Tests named `today:` pin the current behaviour, including behaviour that is wrong. Tests wrapped in
 * `test.failing` describe the intended behaviour and are known defects: they are reported as passing
 * while the defect exists. The fixing change flips them to plain `test`.
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

        test('today: the second close runs an unfiltered stop() that undoes the hand-off (known defect R2)', () => {
            leaveWith('onOK')

            expect(pairing.stop).toHaveBeenCalledTimes(1)
            expect(pairing.stop).toHaveBeenCalledWith([], false)     // no adapter filter: pauses the handed-over adapters too
        })

        test.failing('known defect R2: the second close does not stop the devices that were handed to the ride', () => {
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

        test('today: the second close runs an unfiltered stop() (known defect R2)', () => {
            leaveWith('onSimulate')

            expect(pairing.stop).toHaveBeenCalledTimes(1)
        })

        test.failing('known defect R2: the second close does not stop the simulator hand-off', () => {
            leaveWith('onSimulate')

            expect(pairing.stop).not.toHaveBeenCalled()
        })
    })

    describe('Skip', () => {

        test('today: stops the devices twice, once per close (known defect R2)', () => {
            leaveWith('onSkip')

            expect(pairing.stop).toHaveBeenCalledTimes(2)
            expect(stateMachine.stop).toHaveBeenCalledTimes(2)
        })

        test.failing('known defect R2: stops the devices and the state machine once', () => {
            leaveWith('onSkip')

            expect(pairing.stop).toHaveBeenCalledTimes(1)
            expect(stateMachine.stop).toHaveBeenCalledTimes(1)
        })
    })

    describe('registration of the current page', () => {

        test('today: the second close clears the registration of a page opened in between (known defect R2)', () => {
            service.openPage()
            ;(service as any).onSkip()                         // first close
            const nextPage = { name: 'routes' }
            ;(IncyclistPageService as any).currentPage = nextPage   // the next page registers itself

            service.closePage()                                // unmount hook of the pairing page

            expect((IncyclistPageService as any).currentPage).toBeUndefined()
        })

        test.failing('known defect R2: the second close leaves the next page registered', () => {
            service.openPage()
            ;(service as any).onSkip()
            const nextPage = { name: 'routes' }
            ;(IncyclistPageService as any).currentPage = nextPage

            service.closePage()

            expect((IncyclistPageService as any).currentPage).toBe(nextPage)
        })
    })
})
