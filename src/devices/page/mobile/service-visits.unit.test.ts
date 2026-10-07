import { Inject } from "../../../base/decorators/Injection"
import { DevicesPageService } from "./service"

describe('DevicesPageService - pairing visit tracking', ()=> {

    let service: DevicesPageService

    const tracker = {
        openVisit: jest.fn(),
        closeVisit: jest.fn(),
        onBackground: jest.fn(),
        onForeground: jest.fn(),
    }

    const pairing = {
        getState: jest.fn(),
        start: jest.fn(),
        stop: jest.fn().mockResolvedValue(undefined),
        prepareStart: jest.fn(),
        setReadyToStart: jest.fn(),
        usage: undefined,
    }

    const appState = {
        setState: jest.fn(),
        getState: jest.fn(),
        getPersistedState: jest.fn(),
    }

    const stateMachine = {
        state: 'Idle',
        start: jest.fn(),
        stop: jest.fn(),
        pause: jest.fn().mockResolvedValue(undefined),
        resume: jest.fn(),
    }

    const setCanStartRide = (canStartRide:boolean) => {
        pairing.getState.mockReturnValue({ canStartRide, capabilities:[], interfaces:[] })
    }

    beforeEach( ()=> {
        Inject('PairingVisitTracker', tracker)
        Inject('DevicePairing', pairing)
        Inject('AppState', appState)
        Inject('DeviceConfiguration', { getSimulatorAdapterId: jest.fn().mockReturnValue('sim') })
        Inject('Bindings', { ui: { openPage: jest.fn() } })
        setCanStartRide(false)

        service = new DevicesPageService()
        ;(service as any).stateMachine = stateMachine
        ;(service as any).isVisitOpen = false
        ;(service as any).moveTo = jest.fn()
    })

    afterEach( ()=> {
        (service as any).reset()
        Inject('PairingVisitTracker', null)
        Inject('DevicePairing', null)
        Inject('AppState', null)
        Inject('DeviceConfiguration', null)
        Inject('Bindings', null)
        jest.clearAllMocks()
    })

    test('openPage opens one visit, passing forRide', ()=> {
        service.openPage(true)
        expect(tracker.openVisit).toHaveBeenCalledWith({forRide:true})
    })

    test('a duplicate openPage does not open a second visit', ()=> {
        service.openPage(false)
        service.openPage(false)
        expect(tracker.openVisit).toHaveBeenCalledTimes(1)
    })

    test('openPage after closePage opens a new visit', ()=> {
        service.openPage(false)
        service.closePage()
        service.openPage(false)
        expect(tracker.openVisit).toHaveBeenCalledTimes(2)
    })

    test('closePage alone does not close the visit', ()=> {
        service.openPage(false)
        service.closePage()
        expect(tracker.closeVisit).not.toHaveBeenCalled()
    })

    test('pausePage marks the visit as backgrounded with the current canStartRide', async ()=> {
        setCanStartRide(true)
        await service.pausePage()
        expect(tracker.onBackground).toHaveBeenCalledWith({canStartRide:true})
    })

    test('resumePage marks the visit as foregrounded and does not open a new visit', async ()=> {
        await service.resumePage()
        expect(tracker.onForeground).toHaveBeenCalled()
        expect(tracker.openVisit).not.toHaveBeenCalled()
    })

    test.each([
        ['onOK', 'ok', true],
        ['onSkip', 'skip', false],
        ['onSimulate', 'simulate', false],
        ['onCancel', 'cancel', false],
    ])('%s closes the visit with via:%s', (handler, via, canStartRide)=> {
        setCanStartRide(canStartRide as boolean)
        ;(service as any)[handler as string]()
        expect(tracker.closeVisit).toHaveBeenCalledWith(via, {canStartRide})
    })

    test('a tracker failure does not break the page', ()=> {
        tracker.openVisit.mockImplementationOnce( ()=>{ throw new Error('X') })
        expect( ()=>service.openPage(false)).not.toThrow()
        expect(service.getPageObserver()).toBeDefined()
    })
})
