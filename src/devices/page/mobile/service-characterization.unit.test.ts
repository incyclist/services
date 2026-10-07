import { IncyclistCapability } from "incyclist-devices"

import { Inject } from "../../../base/decorators/Injection"
import { Observer } from "../../../base/types"
import { DevicesPageService } from "./service"

describe('DevicesPageService - characterization of current pairing page behaviour', ()=> {

    let service: DevicesPageService

    const pairing = {
        getState: jest.fn(),
        start: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
        prepareStart: jest.fn(),
        setReadyToStart: jest.fn(),
        selectDevice: jest.fn(),
        deleteDevice: jest.fn(),
        unselectDevices: jest.fn(),
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
    }

    const ui = {
        openPage: jest.fn(),
        quit: jest.fn(),
    }

    const mockIncyclist = {
        onAppExit: jest.fn().mockResolvedValue(undefined),
    }

    const tracker = {
        openVisit: jest.fn(),
        closeVisit: jest.fn(),
        onBackground: jest.fn(),
        onForeground: jest.fn(),
    }

    const stateMachine = {
        state: 'Idle',
        selectState: 'Inactive',
        start: jest.fn(),
        stop: jest.fn(),
        pause: jest.fn().mockResolvedValue(undefined),
        resume: jest.fn(),
        onDeviceSelectionOpened: jest.fn(),
        onDeviceSelectionClosed: jest.fn(),
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

    const setPrevPage = (page: string | undefined) => {
        appState.getState.mockImplementation((key: string) => key === 'prevPage' ? page : undefined)
    }

    beforeEach( ()=> {
        Inject('DevicePairing', pairing)
        Inject('AppState', appState)
        Inject('DeviceConfiguration', deviceConfig)
        Inject('Bindings', { ui })
        Inject('Incyclist', mockIncyclist)
        Inject('PairingVisitTracker', tracker)

        setPairingState({})
        setPersistedPage('routes')
        setPrevPage(undefined)

        service = new DevicesPageService()
        ;(service as any).stateMachine = stateMachine
        ;(service as any).pageObserver = new Observer()
        ;(service as any).moveTo = jest.fn()
    })

    afterEach( ()=> {
        (service as any).reset()
        Inject('DevicePairing', null)
        Inject('AppState', null)
        Inject('DeviceConfiguration', null)
        Inject('Bindings', null)
        Inject('Incyclist', null)
        Inject('PairingVisitTracker', null)
        jest.clearAllMocks()
    })

    describe('display props: tiles and rows', ()=> {

        test('tiles are emitted as Resistance, Power, Speed on top and Heartrate, Cadence, Controller below', ()=> {
            setPairingState({
                capabilities: [
                    { capability: IncyclistCapability.Control, devices: [], selected: undefined },
                    { capability: IncyclistCapability.Power, devices: [], selected: undefined },
                    { capability: IncyclistCapability.Speed, devices: [], selected: undefined },
                    { capability: IncyclistCapability.HeartRate, devices: [], selected: undefined },
                    { capability: IncyclistCapability.Cadence, devices: [], selected: undefined },
                    { capability: IncyclistCapability.AppControl, devices: [], selected: undefined },
                ],
            })

            const props = service.getPageDisplayProperties()

            expect(props.capabilities.top.map(c => c.capability)).toEqual(['control', 'power', 'speed'])
            expect(props.capabilities.bottom.map(c => c.capability)).toEqual(['heartrate', 'cadence', 'app_control'])
        })

        test('a tile without a matching capability is left out of its row', ()=> {
            setPairingState({
                capabilities: [
                    { capability: IncyclistCapability.Power, devices: [], selected: undefined },
                ],
            })

            const props = service.getPageDisplayProperties()

            expect(props.capabilities.top.map(c => c.capability)).toEqual(['power'])
            expect(props.capabilities.bottom).toEqual([])
        })

        test('required tiles carry role "required", optional tiles carry role "optional"', ()=> {
            setPairingState({
                capabilities: [
                    { capability: IncyclistCapability.Control, devices: [], selected: undefined },
                    { capability: IncyclistCapability.HeartRate, devices: [], selected: undefined },
                ],
            })

            const props = service.getPageDisplayProperties()

            expect(props.capabilities.top[0].role).toBe('required')
            expect(props.capabilities.bottom[0].role).toBe('optional')
        })

        test('with no interface available, an empty tile shows "Not searching"', ()=> {
            setPairingState({
                interfaces: [],
                capabilities: [ { capability: IncyclistCapability.Power, devices: [], selected: undefined } ],
            })

            const props = service.getPageDisplayProperties()

            expect(props.capabilities.top[0].emptyFooter).toBe('Not searching')
        })

        test('with an interface connected, an empty required tile shows the required footer', ()=> {
            setPairingState({
                interfaces: [ { name: 'ble', state: 'connected', enabled: true } ],
                capabilities: [ { capability: IncyclistCapability.Power, devices: [], selected: undefined } ],
            })

            const props = service.getPageDisplayProperties()

            expect(props.capabilities.top[0].emptyFooter).toBe(getFooterFor('required'))
        })

        test('a selected tile carries the device name and no empty footer', ()=> {
            setPairingState({
                capabilities: [
                    { capability: IncyclistCapability.Power, devices: [device()], selected: 'udid-1', deviceName: 'Tacx Neo', connectState: 'connected', value: 100, unit: 'W' },
                ],
            })

            const tile = service.getPageDisplayProperties().capabilities.top[0]

            expect(tile.deviceName).toBe('Tacx Neo')
            expect(tile.value).toBe('100')
            expect(tile.unit).toBe('W')
        })

        test('a switched-off capability with a remembered device (T16) shows it dimmed, with a toggle to turn it back on', ()=> {
            setPairingState({
                capabilities: [
                    { capability: IncyclistCapability.Power, devices: [device()], selected: 'udid-1', deviceName: 'Tacx Neo', disabled: true },
                ],
            })

            const tile = service.getPageDisplayProperties().capabilities.top[0]

            expect(tile.deviceName).toBe('Tacx Neo')
            expect(tile.disabled).toBe(true)
            expect(tile.emptyFooter).toBe('Not used')
            expect(typeof tile.onUse).toBe('function')
            expect(tile.onUnselect).toBeUndefined()
        })

        test('a switched-off capability with nothing remembered (T16b) is a plain tile with no toggle', ()=> {
            setPairingState({
                capabilities: [
                    { capability: IncyclistCapability.Power, devices: [], selected: undefined, deviceName: undefined, disabled: true },
                ],
            })

            const tile = service.getPageDisplayProperties().capabilities.top[0]

            expect(tile.deviceName).toBeUndefined()
            expect(tile.disabled).toBe(true)
            expect(tile.emptyFooter).toBe('Not used · tap to search')
            expect(tile.onUse).toBeUndefined()
        })

        test('the Resistance tile is titled "Resistance" and the Controller tile is titled "Controller"', ()=> {
            setPairingState({
                capabilities: [
                    { capability: IncyclistCapability.Control, devices: [], selected: undefined },
                    { capability: IncyclistCapability.AppControl, devices: [], selected: undefined },
                ],
            })

            const props = service.getPageDisplayProperties()

            expect(props.capabilities.top[0].title).toBe('resistance')
            expect(props.capabilities.bottom[0].title).toBe('controller')
        })
    })

    describe('display props: buttons', ()=> {

        test('OK only when the pairing can start a ride', ()=> {
            setPairingState({ canStartRide: true })

            const labels = service.getPageDisplayProperties().buttons.map(b => b.label)

            expect(labels).toEqual(['OK'])
        })

        test('Simulate and Cancel when no ride is possible, opened for a ride', ()=> {
            setPairingState({ canStartRide: false })
            ;(service as any).isPairingForRide = true

            const labels = service.getPageDisplayProperties().buttons.map(b => b.label)

            expect(labels).toEqual(['Simulate', 'Cancel'])
        })

        test('Skip only when no ride is possible, not opened for a ride - nothing to simulate', ()=> {
            setPairingState({ canStartRide: false })
            ;(service as any).isPairingForRide = false

            const labels = service.getPageDisplayProperties().buttons.map(b => b.label)

            expect(labels).toEqual(['Skip'])
        })
    })

    describe('display props: rows and interfaces', ()=> {

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

        test.each([
            ['connected', 'scanning'],
            ['connecting', 'idle'],
            ['disconnected', 'error'],
            ['disconnecting', 'idle'],
            ['unavailable', 'error'],
            ['unknown', 'idle'],
        ])('interface state %s maps to display state %s', (state, expected)=> {
            expect((service as any).mapInterfaceState(state)).toBe(expected)
        })

        test('the interface list reflects the interfaces in the pairing state', ()=> {
            setPairingState({ interfaces: [ { name: 'ble', state: 'connected', enabled: true } ] })

            const props = service.getPageDisplayProperties()

            expect(props.interfaces.map(i => i.name)).toEqual(['ble'])
            expect(props.interfaces[0].state).toBe('scanning')
        })

        test('readyToStart mirrors canStartRide', ()=> {
            setPairingState({ canStartRide: true })

            expect(service.getPageDisplayProperties().readyToStart).toBe(true)
        })

        test('the page title is "Devices"', ()=> {
            expect(service.getPageDisplayProperties().title).toBe('Devices')
        })

        test('when building the props throws, the page falls back to an empty grid with a Skip button', ()=> {
            pairing.getState.mockImplementationOnce(()=> { throw new Error('boom') })

            const props = service.getPageDisplayProperties()

            expect(props.capabilities).toEqual({ top: [], bottom: [] })
            expect(props.interfaces).toEqual([])
            expect(props.buttons.map(b => b.label)).toEqual(['Skip'])
        })
    })

    describe('device list: open, select, delete, close', ()=> {

        test('opening a capability notifies the state machine and shows the list for that capability', ()=> {
            setPairingState({
                capabilities: [ { capability: IncyclistCapability.Power, devices: [device()], selected: undefined } ],
            })

            ;(service as any).openDeviceSelection(IncyclistCapability.Power)
            const list = service.getPageDisplayProperties().deviceSelection

            expect(stateMachine.onDeviceSelectionOpened).toHaveBeenCalled()
            expect(list.capability).toBe(IncyclistCapability.Power)
            expect(list.devices).toHaveLength(1)
        })

        test('opening a capability to browse does not switch it back on by itself', ()=> {
            setPairingState({
                capabilities: [ { capability: IncyclistCapability.Power, devices: [device()], selected: undefined } ],
            })

            ;(service as any).openDeviceSelection(IncyclistCapability.Power)

            expect(deviceConfig.disableCapability).not.toHaveBeenCalled()
        })

        test('"select all" is offered only for Resistance', ()=> {
            setPairingState({ capabilities: [ { capability: IncyclistCapability.Control, devices: [], selected: undefined } ] })
            ;(service as any).openedCapability = IncyclistCapability.Control
            expect((service as any).getDeviceListDisplayProps().canSelectAll).toBe(true)

            ;(service as any).openedCapability = IncyclistCapability.Power
            expect((service as any).getDeviceListDisplayProps().canSelectAll).toBe(false)
        })

        test('the list is disabled when devices exist but none is selected', ()=> {
            setPairingState({ capabilities: [ { capability: IncyclistCapability.Power, devices: [device({ selected: false })], selected: undefined } ] })
            ;(service as any).openedCapability = IncyclistCapability.Power

            expect((service as any).getDeviceListDisplayProps().disabled).toBe(true)
        })

        test('the list reports scanning while the device-selection state machine is Active', ()=> {
            setPairingState({ capabilities: [ { capability: IncyclistCapability.Power, devices: [], selected: undefined } ] })
            ;(service as any).openedCapability = IncyclistCapability.Power
            stateMachine.selectState = 'Active'

            const scanning = (service as any).getDeviceListDisplayProps().isScanning

            stateMachine.selectState = 'Inactive'
            expect(scanning).toBe(true)
        })

        test('selecting a device closes the list and selects it for the opened capability', ()=> {
            setPairingState({ capabilities: [ { capability: IncyclistCapability.Power, devices: [device({ selected: false })], selected: undefined } ] })
            ;(service as any).openedCapability = IncyclistCapability.Power
            const d = device({ selected: false })

            ;(service as any).onDeviceSelected(d, false)

            expect(pairing.selectDevice).toHaveBeenCalledWith(IncyclistCapability.Power, d.udid, false)
            expect(stateMachine.onDeviceSelectionClosed).toHaveBeenCalled()
        })

        test('selecting with "for all" passes addAll through', ()=> {
            setPairingState({ capabilities: [ { capability: IncyclistCapability.Control, devices: [device({ selected: false })], selected: undefined } ] })
            ;(service as any).openedCapability = IncyclistCapability.Control
            const d = device({ selected: false })

            ;(service as any).onDeviceSelected(d, true)

            expect(pairing.selectDevice).toHaveBeenCalledWith(IncyclistCapability.Control, d.udid, true)
        })

        test('deleting a device removes it for the opened capability and keeps the list open', ()=> {
            setPairingState({ capabilities: [ { capability: IncyclistCapability.Power, devices: [device()], selected: undefined } ] })
            ;(service as any).openedCapability = IncyclistCapability.Power
            const d = device()

            ;(service as any).onDeviceDelete(d)

            expect(pairing.deleteDevice).toHaveBeenCalledWith(IncyclistCapability.Power, d.udid)
            expect((service as any).openedCapability).toBe(IncyclistCapability.Power)
        })

        test('closing the list keeps the selection and closes the device-selection state', async ()=> {
            setPairingState({ capabilities: [ { capability: IncyclistCapability.Power, devices: [device()], selected: undefined } ] })
            ;(service as any).openedCapability = IncyclistCapability.Power

            await (service as any).closeDeviceSelection()

            expect(pairing.unselectDevices).not.toHaveBeenCalled()
            expect((service as any).openedCapability).toBeUndefined()
            expect(stateMachine.onDeviceSelectionClosed).toHaveBeenCalled()
        })
    })

    describe('navigation targets', ()=> {

        test('OK with no previous page (app just launched) goes to the content page', ()=> {
            setPrevPage(undefined)
            setPersistedPage('routes')

            ;(service as any).onOK()

            expect((service as any).moveTo).toHaveBeenCalledWith('/routes')
        })

        test('OK after a previous page in ride mode goes to /rideDeviceOK', ()=> {
            setPrevPage('routes')
            ;(service as any).isPairingForRide = true

            ;(service as any).onOK()

            expect((service as any).moveTo).toHaveBeenCalledWith('/rideDeviceOK')
        })

        test('OK after a previous page in normal mode goes to the content page', ()=> {
            setPrevPage('routes')
            setPersistedPage('workouts')
            ;(service as any).isPairingForRide = false

            ;(service as any).onOK()

            expect((service as any).moveTo).toHaveBeenCalledWith('/workouts')
        })

        test('OK prepares the start and marks the user as paired', ()=> {
            setPrevPage('routes')

            ;(service as any).onOK()

            expect(pairing.prepareStart).toHaveBeenCalled()
            expect(pairing.setReadyToStart).toHaveBeenCalled()
            expect(appState.setState).toHaveBeenCalledWith('paired', true)
        })

        test('Skip goes to the last content page with a leading slash', ()=> {
            setPersistedPage('routes')

            ;(service as any).onSkip()

            expect((service as any).moveTo).toHaveBeenCalledWith('/routes')
        })

        test('Cancel returns to the previous page with a leading slash', ()=> {
            setPrevPage('workouts')

            ;(service as any).onCancel()

            expect((service as any).moveTo).toHaveBeenCalledWith('/workouts')
        })

        test('Simulate in ride mode starts /rideSimulate with the simulator adapter', ()=> {
            ;(service as any).isPairingForRide = true

            ;(service as any).onSimulate()

            expect(pairing.prepareStart).toHaveBeenCalledWith(['simulator-id'])
            expect((service as any).moveTo).toHaveBeenCalledWith('/rideSimulate')
        })

        test('Simulate outside ride mode returns to the content page', ()=> {
            setPersistedPage('routes')
            ;(service as any).isPairingForRide = false

            ;(service as any).onSimulate()

            expect((service as any).moveTo).toHaveBeenCalledWith('/routes')
        })
    })

    describe('pause, resume and Android exit', ()=> {

        test('pausePage pauses the state machine and reports the background time to the visit', async ()=> {
            await service.pausePage()

            expect(stateMachine.pause).toHaveBeenCalled()
            expect(tracker.onBackground).toHaveBeenCalledWith({ canStartRide: false })
        })

        test('resumePage resumes the state machine and restarts pairing when it is not open', async ()=> {
            await service.resumePage()

            expect(stateMachine.resume).toHaveBeenCalled()
            expect(pairing.start).toHaveBeenCalled()
            expect(pairing.usage).toBe('page')
        })

        test('resumePage does not restart pairing while an open is still in progress', async ()=> {
            ;(service as any).promiseOpen = new Promise<void>(()=>{})

            await service.resumePage()

            expect(pairing.start).not.toHaveBeenCalled()
        })

        test('Android exit runs app exit first and then quits the UI', async ()=> {
            const props = service.getPageDisplayProperties()

            props.onExit()
            await flushPromises()

            expect(mockIncyclist.onAppExit).toHaveBeenCalled()
            expect(ui.quit).toHaveBeenCalled()
        })

        test('a failing app exit does not quit the UI', async ()=> {
            mockIncyclist.onAppExit.mockRejectedValueOnce(new Error('exit failed'))
            const props = service.getPageDisplayProperties()

            props.onExit()
            await flushPromises()

            expect(ui.quit).not.toHaveBeenCalled()
        })
    })
})

// The copy itself is asserted by the guidance unit tests. These helpers only say which copy id
// the page is expected to pick, so the assertions stay readable.
function getFooterFor(role: 'required' | 'optional'): string | undefined {
    return jest.requireActual('../../pairing').getEmptyTileFooterText(role)
}

function getGuidanceFor(id: string) {
    return jest.requireActual('../../pairing').getPairingGuidanceText(id)
}

const flushPromises = () => new Promise<void>( resolve => setImmediate(resolve) )
