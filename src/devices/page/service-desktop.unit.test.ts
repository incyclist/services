import { Inject } from "../../base/decorators/Injection"
import { DesktopPairingPageService } from "./desktop-service"
import { IncyclistCapability } from "incyclist-devices"
import { Observer } from "../../base/types"

// Binds the desktop behaviour matrix (__tests__/desktop-matrix.ts) to DesktopPairingPageService.
// Test names echo each matrix row's `name` so the two stay easy to cross-check.
describe('DesktopPairingPageService - desktop behaviour matrix (CP8)', ()=> {

    let service: DesktopPairingPageService

    const pairing = {
        getState: jest.fn(),
        start: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
        prepareStart: jest.fn(),
        setReadyToStart: jest.fn(),
        selectDevice: jest.fn(),
        deleteDevice: jest.fn(),
        unselectDevices: jest.fn(),
        useCapability: jest.fn(),
        startDeviceSelection: jest.fn(),
        stopDeviceSelection: jest.fn().mockResolvedValue(undefined),
        changeInterfaceSettings: jest.fn(),
        usage: undefined,
    }

    const appState = {
        setState: jest.fn(),
        getState: jest.fn(),
        getPersistedState: jest.fn(),
    }

    const deviceRide = {
        canEnforceSimulator: jest.fn().mockReturnValue(false),
    }

    const deviceConfig = {
        getSimulatorAdapterId: jest.fn().mockReturnValue('simulator-id'),
        disableCapability: jest.fn(),
        add: jest.fn(),
    }

    const deviceAccess = {
        enrichWithAccessState: jest.fn( (ifs:Array<unknown>)=>ifs),
    }

    const routeList = {
        getSelected: jest.fn().mockReturnValue(undefined),
        getStartSettings: jest.fn().mockReturnValue(undefined),
    }

    const workoutList = {
        getSelected: jest.fn().mockReturnValue(undefined),
    }

    const tracker = {
        openVisit: jest.fn(),
        closeVisit: jest.fn(),
        onBackground: jest.fn(),
        onForeground: jest.fn(),
    }

    const setPairingState = (state: Record<string, unknown>) => {
        pairing.getState.mockReturnValue({ capabilities: [], interfaces: [], canStartRide: false, ...state })
    }

    const device = (props: Record<string, unknown> = {}) => ({
        udid: 'udid-1',
        name: 'Tacx Neo',
        interface: 'ble',
        connectState: 'connected',
        value: 100,
        unit: 'W',
        selected: true,
        ...props,
    })

    const setPersistedPage = (page: string | undefined) => {
        appState.getPersistedState.mockImplementation((key: string) => key === 'page' ? page : undefined)
    }

    beforeEach( ()=> {
        Inject('DevicePairing', pairing)
        Inject('AppState', appState)
        Inject('DeviceRide', deviceRide)
        Inject('DeviceConfiguration', deviceConfig)
        Inject('DeviceAccess', deviceAccess)
        Inject('RouteListService', routeList)
        Inject('WorkoutListService', workoutList)
        Inject('PairingVisitTracker', tracker)

        setPairingState({})
        setPersistedPage('routes')
        routeList.getSelected.mockReturnValue(undefined)
        routeList.getStartSettings.mockReturnValue(undefined)
        workoutList.getSelected.mockReturnValue(undefined)

        service = new DesktopPairingPageService()
        ;(service as any).pageObserver = new Observer()
        ;(service as any).moveTo = jest.fn()
    })

    afterEach( ()=> {
        (service as any).reset()
        Inject('DevicePairing', null)
        Inject('AppState', null)
        Inject('DeviceRide', null)
        Inject('DeviceConfiguration', null)
        Inject('DeviceAccess', null)
        Inject('RouteListService', null)
        Inject('WorkoutListService', null)
        Inject('PairingVisitTracker', null)
        jest.clearAllMocks()
    })

    describe('buttons', ()=> {

        test('ready, ride mode: primary "Start", secondary "Cancel"', ()=> {
            setPairingState({ canStartRide: true })
            ;(service as any).isPairingForRide = true

            const buttons = service.getPageDisplayProperties().buttons

            expect(buttons.map(b=>({label:b.label, primary:b.primary}))).toEqual([
                { label:'Start', primary:true },
                { label:'Cancel', primary:false },
            ])
        })

        test('ready, normal mode: primary "OK", secondary "Skip"', ()=> {
            setPairingState({ canStartRide: true })
            ;(service as any).isPairingForRide = false

            const buttons = service.getPageDisplayProperties().buttons

            expect(buttons.map(b=>({label:b.label, primary:b.primary}))).toEqual([
                { label:'OK', primary:true },
                { label:'Skip', primary:false },
            ])
        })

        test('not ready, ride mode, simulator enforceable at open: primary "Simulate", secondary "Cancel"', ()=> {
            setPairingState({ canStartRide: false })
            ;(service as any).isPairingForRide = true
            ;(service as any).showSimulateCache = true

            const buttons = service.getPageDisplayProperties().buttons

            expect(buttons.map(b=>b.label)).toEqual(['Simulate', 'Cancel'])
        })

        test('not ready, ride mode, no simulator: primary "Cancel" only', ()=> {
            setPairingState({ canStartRide: false })
            ;(service as any).isPairingForRide = true
            ;(service as any).showSimulateCache = false

            const buttons = service.getPageDisplayProperties().buttons

            expect(buttons.map(b=>b.label)).toEqual(['Cancel'])
        })

        test('not ready, normal mode: primary "Skip", no Simulate', ()=> {
            setPairingState({ canStartRide: false })
            ;(service as any).isPairingForRide = false
            ;(service as any).showSimulateCache = true // simulate is ride-mode only, even if cached true

            const buttons = service.getPageDisplayProperties().buttons

            expect(buttons.map(b=>b.label)).toEqual(['Skip'])
        })
    })

    describe('ok-navigation', ()=> {

        test('OK with a route selected navigates to /rideOK', ()=> {
            routeList.getSelected.mockReturnValue({ title:'My Route' })

            ;(service as any).onOK()

            expect((service as any).moveTo).toHaveBeenCalledWith('/rideOK')
        })

        test('OK with a workout selected navigates to /rideOK', ()=> {
            workoutList.getSelected.mockReturnValue({ name:'My Workout' })

            ;(service as any).onOK()

            expect((service as any).moveTo).toHaveBeenCalledWith('/rideOK')
        })

        test('OK with free ride navigates to /rideDeviceOK', ()=> {
            routeList.getStartSettings.mockReturnValue({ type:'Free-Ride' })

            ;(service as any).onOK()

            expect((service as any).moveTo).toHaveBeenCalledWith('/rideDeviceOK')
        })

        test('OK with nothing selected navigates to the persisted content page', ()=> {
            setPersistedPage('workouts')

            ;(service as any).onOK()

            expect((service as any).moveTo).toHaveBeenCalledWith('/workouts')
        })

        test('OK closes the visit as ok and prepares the start', ()=> {
            ;(service as any).onOK()

            expect(tracker.closeVisit).toHaveBeenCalledWith('ok', expect.anything())
            expect(pairing.prepareStart).toHaveBeenCalled()
            expect(pairing.setReadyToStart).toHaveBeenCalled()
            expect(appState.setState).toHaveBeenCalledWith('paired', true)
        })
    })

    describe('skip', ()=> {

        test('Skip in normal mode returns to the source', ()=> {
            ;(service as any).isPairingForRide = false
            ;(service as any).source = '/activities'

            ;(service as any).onSkip()

            expect((service as any).moveTo).toHaveBeenCalledWith('/activities')
            expect(tracker.closeVisit).toHaveBeenCalledWith('skip', expect.anything())
            expect(pairing.stop).toHaveBeenCalled()
        })

        test('Skip in normal mode without a source returns to the persisted content page', ()=> {
            ;(service as any).isPairingForRide = false
            ;(service as any).source = undefined
            setPersistedPage('routes')

            ;(service as any).onSkip()

            expect((service as any).moveTo).toHaveBeenCalledWith('/routes')
        })

        test('Cancel in ride mode returns to the source', ()=> {
            ;(service as any).isPairingForRide = true
            ;(service as any).source = '/rideOverview'

            ;(service as any).onSkip()

            expect((service as any).moveTo).toHaveBeenCalledWith('/rideOverview')
            expect(tracker.closeVisit).toHaveBeenCalledWith('cancel', expect.anything())
        })
    })

    describe('simulate', ()=> {

        test('Simulate with a route selected starts /rideSimulate', ()=> {
            routeList.getSelected.mockReturnValue({ title:'My Route' })
            ;(service as any).isPairingForRide = true

            ;(service as any).onSimulate()

            expect(deviceConfig.getSimulatorAdapterId).toHaveBeenCalled()
            expect(pairing.prepareStart).toHaveBeenCalledWith(['simulator-id'])
            expect((service as any).moveTo).toHaveBeenCalledWith('/rideSimulate')
            expect(tracker.closeVisit).toHaveBeenCalledWith('simulate', expect.anything())
        })
    })

    describe('simulator', ()=> {

        test('addSimulator adds the simulator device', ()=> {
            service.addSimulator()

            expect(deviceConfig.add).toHaveBeenCalledWith({ name:'Simulator', interface:'simulator' })
        })
    })

    describe('tiles', ()=> {

        test('Tile unselect unselects the capability', ()=> {
            ;(service as any).onCapabilityUnselect(IncyclistCapability.Power)

            expect(pairing.unselectDevices).toHaveBeenCalledWith(IncyclistCapability.Power)
        })
    })

    describe('device-list', ()=> {

        test('opening a tile opens its device list for that capability', ()=> {
            pairing.startDeviceSelection.mockReturnValue({ capability:IncyclistCapability.Power, devices:[device()] })

            ;(service as any).openDeviceSelection(IncyclistCapability.Power)
            const list = service.getPageDisplayProperties().deviceSelection

            expect(pairing.startDeviceSelection).toHaveBeenCalledWith(IncyclistCapability.Power, expect.any(Function))
            expect(list.capability).toBe(IncyclistCapability.Power)
            expect(list.devices).toHaveLength(1)
        })

        test('selecting a device for Resistance defaults "change for all" to true', ()=> {
            ;(service as any).openedCapability = IncyclistCapability.Control
            const d = device({ selected:false })

            ;(service as any).onDeviceSelected(d)

            expect(pairing.selectDevice).toHaveBeenCalledWith(IncyclistCapability.Control, d.udid, true)
        })

        test('selecting a device for any other capability defaults "change for all" to false', ()=> {
            ;(service as any).openedCapability = IncyclistCapability.Power
            const d = device({ selected:false })

            ;(service as any).onDeviceSelected(d)

            expect(pairing.selectDevice).toHaveBeenCalledWith(IncyclistCapability.Power, d.udid, false)
        })

        test('"select all" is offered only for Resistance', ()=> {
            pairing.startDeviceSelection.mockReturnValue({ capability:IncyclistCapability.Control, devices:[] })
            ;(service as any).openDeviceSelection(IncyclistCapability.Control)
            expect(service.getPageDisplayProperties().deviceSelection.canSelectAll).toBe(true)

            pairing.startDeviceSelection.mockReturnValue({ capability:IncyclistCapability.Power, devices:[] })
            ;(service as any).openDeviceSelection(IncyclistCapability.Power)
            expect(service.getPageDisplayProperties().deviceSelection.canSelectAll).toBe(false)
        })

        test('deleting a device in the list keeps the list open', ()=> {
            ;(service as any).openedCapability = IncyclistCapability.Power
            const d = device()

            ;(service as any).onDeviceDelete(d)

            expect(pairing.deleteDevice).toHaveBeenCalledWith(IncyclistCapability.Power, d.udid)
            expect((service as any).openedCapability).toBe(IncyclistCapability.Power)
        })

        test('cancelling the device list stops the scan and keeps the current selection', ()=> {
            ;(service as any).openedCapability = IncyclistCapability.Power

            ;(service as any).closeDeviceSelection()

            expect(pairing.stopDeviceSelection).toHaveBeenCalled()
            expect(pairing.unselectDevices).not.toHaveBeenCalled()
            expect((service as any).openedCapability).toBeUndefined()
        })
    })

    describe('interfaces', ()=> {

        test('an interface settings change calls changeInterfaceSettings', ()=> {
            service.onInterfaceSettingsChanged('ant', { enabled:true } as any)

            expect(pairing.changeInterfaceSettings).toHaveBeenCalledWith('ant', { enabled:true })
        })

        test('every enabled interface is shown with its raw state, not a mapped display state', ()=> {
            setPairingState({ interfaces: [
                { name:'ant', state:'connected', isScanning:true, enabled:true, protocol:undefined, port:3 },
                { name:'serial', state:'unavailable', isScanning:false, enabled:true, protocol:'Daum Classic', port:'COM3' },
            ] })

            const interfaces = service.getPageDisplayProperties().interfaces

            expect(interfaces).toEqual([
                expect.objectContaining({ name:'ant', state:'connected', isScanning:true, enabled:true, port:3 }),
                expect.objectContaining({ name:'serial', state:'unavailable', isScanning:false, enabled:true, protocol:'Daum Classic', port:'COM3' }),
            ])
        })
    })

    describe('usage mode', ()=> {

        test('starting the page sets usage to direct, not page', async ()=> {
            await (service as any).start()

            expect(pairing.usage).toBe('direct')
        })
    })
})
