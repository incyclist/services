import { IncyclistCapability } from 'incyclist-devices'

import { Inject } from '../../../base/decorators/Injection'
import { IncyclistPageService } from '../../../base/pages'
import { DevicesPageService } from './service'

describe('DevicesPageService - callbacks arriving after the page was closed', ()=> {

    let service: DevicesPageService
    let onStateMachineUpdate: (()=>void) | undefined
    let observerDuringStop: unknown

    const pairing = {
        getState: jest.fn(),
        start: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
        prepareStart: jest.fn().mockResolvedValue(undefined),
        setReadyToStart: jest.fn(),
        isReadyToStart: jest.fn().mockReturnValue(false),
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
        onBackground: jest.fn(),
        onForeground: jest.fn(),
    }

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

    beforeEach( ()=> {
        Inject('DevicePairing', pairing)
        Inject('AppState', appState)
        Inject('DeviceConfiguration', {})
        Inject('Bindings', { ui: { openPage: jest.fn(), quit: jest.fn() } })
        Inject('PairingVisitTracker', tracker)

        pairing.getState.mockReturnValue({
            capabilities: [{ capability: IncyclistCapability.AppControl, devices: [], selected: undefined }],
            interfaces: [],
            canStartRide: false,
        })
        appState.getPersistedState.mockReturnValue('routes')

        observerDuringStop = undefined
        onStateMachineUpdate = undefined
        stateMachine.start.mockImplementation( (cb: ()=>void) => { onStateMachineUpdate = cb })
        stateMachine.stop.mockImplementation( () => { observerDuringStop = service.getPageObserver() })

        service = new DevicesPageService()
        ;(service as any).stateMachine = stateMachine
    })

    afterEach( ()=> {
        service.closePage()
        ;(service as any).reset()
        Inject('DevicePairing', null)
        Inject('AppState', null)
        Inject('DeviceConfiguration', null)
        Inject('Bindings', null)
        Inject('PairingVisitTracker', null)
        jest.clearAllMocks()
    })

    test('a state machine update arriving after closePage() does not throw', ()=> {
        const observer = service.openPage()
        const onPageUpdate = jest.fn()
        observer.on('page-update', onPageUpdate)

        service.closePage()

        expect(() => onStateMachineUpdate?.()).not.toThrow()
        expect(onPageUpdate).not.toHaveBeenCalled()
    })

    test('a capability click arriving after closePage() does not throw', ()=> {
        service.openPage()
        service.closePage()

        expect(() => (service as any).openDeviceSelection(IncyclistCapability.AppControl)).not.toThrow()
    })

    test('a capability click arriving while the app exit closes the current page does not throw', ()=> {
        service.openPage()

        // what UIService.onAppExit() does before it starts the (slow) device teardown
        IncyclistPageService.closePage()

        expect(() => (service as any).openDeviceSelection(IncyclistCapability.AppControl)).not.toThrow()
        expect(() => onStateMachineUpdate?.()).not.toThrow()
    })

    test('the state machine is stopped before the page observer is deleted', ()=> {
        service.openPage()
        const observer = service.getPageObserver()

        service.closePage()

        expect(stateMachine.stop).toHaveBeenCalledTimes(1)
        expect(observerDuringStop).toBe(observer)
        expect(service.getPageObserver()).toBeUndefined()
    })

    test('an update while the page is open still reaches the page observer', ()=> {
        const observer = service.openPage()
        const onPageUpdate = jest.fn()
        observer.on('page-update', onPageUpdate)

        onStateMachineUpdate?.()

        expect(onPageUpdate).toHaveBeenCalledTimes(1)
    })
})
