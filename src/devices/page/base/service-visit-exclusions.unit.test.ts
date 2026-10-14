import { Inject } from "../../../base/decorators/Injection"
import { DesktopPairingPageService } from "../desktop/service"
import { DevicesPageService } from "../mobile/service"

// The page tells the pairing service when a visit opens and closes: opening clears the
// exclusions that only last until the next visit, and the open visit gates auto-revert.
describe.each([
    ['mobile', ()=>new DevicesPageService()],
    ['desktop', ()=>new DesktopPairingPageService()],
])('%s pairing page - visit state for exclusions', (_platform, create)=> {

    let service: DevicesPageService|DesktopPairingPageService

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
        prepareStart: jest.fn().mockResolvedValue(undefined),
        setReadyToStart: jest.fn(),
        setVisitOpen: jest.fn(),
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

    beforeEach( ()=> {
        Inject('PairingVisitTracker', tracker)
        Inject('DevicePairing', pairing)
        Inject('AppState', appState)
        Inject('DeviceConfiguration', { getSimulatorAdapterId: jest.fn().mockReturnValue('sim') })
        Inject('DeviceAccess', { enrichWithAccessState: jest.fn() })
        Inject('Bindings', { ui: { openPage: jest.fn() } })
        pairing.getState.mockReturnValue({ canStartRide:true, capabilities:[], interfaces:[] })

        service = create()
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
        Inject('DeviceAccess', null)
        Inject('Bindings', null)
        jest.clearAllMocks()
    })

    test('openPage marks the visit open in the pairing service', ()=> {
        service.openPage(false)
        expect(pairing.setVisitOpen).toHaveBeenCalledWith(true)
    })

    test('a repeated openPage on a visit that is already open marks it open again, so exclusions are cleared again', ()=> {
        service.openPage(false)
        service.openPage(false)

        expect(tracker.openVisit).toHaveBeenCalledTimes(1)
        expect(pairing.setVisitOpen.mock.calls.filter( ([open])=>open===true)).toHaveLength(2)
    })

    test('resumePage does not mark the visit open again', async ()=> {
        service.openPage(false)
        pairing.setVisitOpen.mockClear()

        await service.pausePage()
        await service.resumePage()

        expect(pairing.setVisitOpen).not.toHaveBeenCalledWith(true)
    })

    test('OK marks the visit closed before the ride is prepared', ()=> {
        service.openPage(false)
        pairing.setVisitOpen.mockClear()

        ;(service as any).onOK()

        expect(pairing.setVisitOpen).toHaveBeenCalledWith(false)
        expect(pairing.setVisitOpen.mock.invocationCallOrder[0]).toBeLessThan(pairing.prepareStart.mock.invocationCallOrder[0])
    })

    test('closePage marks the visit closed', ()=> {
        service.openPage(false)
        pairing.setVisitOpen.mockClear()

        service.closePage()

        expect(pairing.setVisitOpen).toHaveBeenCalledWith(false)
    })

    test('a failing pairing service does not break opening the page', ()=> {
        pairing.setVisitOpen.mockImplementationOnce( ()=>{ throw new Error('boom') })

        expect( ()=>service.openPage(false)).not.toThrow()
        expect(tracker.openVisit).toHaveBeenCalledTimes(1)
    })
})
