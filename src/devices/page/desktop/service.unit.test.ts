import { Inject } from "../../../base/decorators/Injection"
import { DesktopPairingPageService } from "./service"
import { IncyclistCapability } from "incyclist-devices"
import { Observer } from "../../../base/types"

// Binds the desktop behaviour matrix (./matrix.ts) to DesktopPairingPageService.
// Test names echo each matrix row's `name` so the two stay easy to cross-check.
describe('DesktopPairingPageService - desktop behaviour matrix', ()=> {

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

    const deviceConfig = {
        getSimulatorAdapterId: jest.fn().mockReturnValue('simulator-id'),
        disableCapability: jest.fn(),
        add: jest.fn(),
    }

    const deviceAccess = {
        enrichWithAccessState: jest.fn( (ifs:Array<unknown>)=>ifs),
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
        Inject('DeviceConfiguration', deviceConfig)
        Inject('DeviceAccess', deviceAccess)
        Inject('PairingVisitTracker', tracker)

        setPairingState({})
        setPersistedPage('routes')

        service = new DesktopPairingPageService()
        ;(service as any).pageObserver = new Observer()
        ;(service as any).moveTo = jest.fn()
    })

    afterEach( ()=> {
        (service as any).reset()
        Inject('DevicePairing', null)
        Inject('AppState', null)
        Inject('DeviceConfiguration', null)
        Inject('DeviceAccess', null)
        Inject('PairingVisitTracker', null)
        jest.clearAllMocks()
    })

    // getButtonsDisplayProps() is shared with mobile (base class), not overridden here - these
    // tests just confirm desktop gets the right labels (Start/Cancel vs OK/Skip) out of it.
    describe('buttons', ()=> {

        test('ready, ride mode: "Start"', ()=> {
            setPairingState({ canStartRide: true })
            ;(service as any).isPairingForRide = true

            const buttons = service.getPageDisplayProperties().buttons

            expect(buttons.map(b=>b.label)).toEqual(['Start'])
        })

        test('ready, normal mode: "OK"', ()=> {
            setPairingState({ canStartRide: true })
            ;(service as any).isPairingForRide = false

            const buttons = service.getPageDisplayProperties().buttons

            expect(buttons.map(b=>b.label)).toEqual(['OK'])
        })

        test('not ready, ride mode: primary "Simulate", secondary "Cancel"', ()=> {
            setPairingState({ canStartRide: false })
            ;(service as any).isPairingForRide = true

            const buttons = service.getPageDisplayProperties().buttons

            expect(buttons.map(b=>b.label)).toEqual(['Simulate', 'Cancel'])
        })

        test('not ready, normal mode: primary "Simulate", secondary "Skip"', ()=> {
            setPairingState({ canStartRide: false })
            ;(service as any).isPairingForRide = false

            const buttons = service.getPageDisplayProperties().buttons

            expect(buttons.map(b=>b.label)).toEqual(['Simulate', 'Skip'])
        })
    })

    describe('rows and status', ()=> {

        test('the top row label flips to the connected-trainer wording when a control device is selected', ()=> {
            setPairingState({
                capabilities: [ { capability: IncyclistCapability.Control, devices: [device()], selected: 'udid-1', deviceName: 'Trainer' } ],
            })

            const props = service.getPageDisplayProperties()

            expect(props.capabilities.rowLabels.top).toEqual(getGuidanceFor('row-required-trainer'))
        })

        test('the top row label uses the plain wording when no control device is selected', ()=> {
            setPairingState({ capabilities: [ { capability: IncyclistCapability.Control, devices: [], selected: undefined } ] })

            const props = service.getPageDisplayProperties()

            expect(props.capabilities.rowLabels.top).toEqual(getGuidanceFor('row-required'))
        })

        test('the bottom row label is always the optional wording', ()=> {
            setPairingState({})

            const props = service.getPageDisplayProperties()

            expect(props.capabilities.rowLabels.bottom).toEqual(getGuidanceFor('row-optional'))
        })

        test('status is computed for the desktop platform', ()=> {
            setPairingState({ canStartRide: true })

            const props = service.getPageDisplayProperties()

            expect(props.status).toBeDefined()
        })
    })

    describe('ok-navigation', ()=> {

        test('OK in ride mode starts the ride', ()=> {
            ;(service as any).isPairingForRide = true

            ;(service as any).onOK()

            expect((service as any).moveTo).toHaveBeenCalledWith('/rideOK')
        })

        test('OK outside ride mode returns to the persisted content page', ()=> {
            ;(service as any).isPairingForRide = false
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

        test('Simulate in ride mode starts /rideSimulate', ()=> {
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

        test('an invisible interface (wifi, implicitly on outside Windows) is not shown', ()=> {
            setPairingState({ interfaces: [
                { name:'ant', state:'connected', isScanning:true, enabled:true },
                { name:'wifi', state:'connected', isScanning:false, enabled:true, invisible:true },
            ] })

            const interfaces = service.getPageDisplayProperties().interfaces

            expect(interfaces.map(i=>i.name)).toEqual(['ant'])
        })
    })

    describe('openPage inputs', ()=> {

        test('openPage stores the source Skip/Cancel should return to', ()=> {
            service.openPage(true, '/routes')

            expect((service as any).source).toBe('/routes')
        })
    })

    describe('usage mode', ()=> {

        test('starting the page sets usage to direct, not page', async ()=> {
            await (service as any).start()

            expect(pairing.usage).toBe('direct')
        })
    })
})

function getGuidanceFor(id: string) {
    return jest.requireActual('../../pairing').getPairingGuidanceText(id)
}
