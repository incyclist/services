import { IncyclistCapability } from "incyclist-devices"
import { Inject } from "../../../base/decorators/Injection"
import { Observer } from "../../../base/types"
import type { SearchStatus } from "../../pairing"
import { DesktopPairingPageService } from "../desktop/service"
import { DevicesPageService } from "../mobile/service"

// What the Pairing page shows around the search for devices: no OK while it runs, Stop searching
// once something to ride with was found, Search again after a search that ended without a trainer.
describe.each([
    ['mobile', ()=>new DevicesPageService()],
    ['desktop', ()=>new DesktopPairingPageService()],
])('%s pairing page - search for devices', (_platform, create)=> {

    let service: DevicesPageService|DesktopPairingPageService

    const pairing = {
        getState: jest.fn(),
        getSearchStatus: jest.fn(),
        stopSearch: jest.fn(),
        searchAgain: jest.fn(),
        start: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
        prepareStart: jest.fn().mockResolvedValue(undefined),
        setReadyToStart: jest.fn(),
        setVisitOpen: jest.fn(),
        usage: undefined,
    }

    const appState = { setState: jest.fn(), getState: jest.fn(), getPersistedState: jest.fn() }
    const tracker = { openVisit: jest.fn(), closeVisit: jest.fn(), onBackground: jest.fn(), onForeground: jest.fn() }

    const IDLE: SearchStatus = { running:false, ended:false, index:0, rideCapableFound:false, trainerFound:false, canStop:false, canSearchAgain:false, missing:[] }
    const setSearch = (status: Partial<SearchStatus>) => { pairing.getSearchStatus.mockReturnValue({ ...IDLE, ...status }) }

    const power = { capability: IncyclistCapability.Power, devices: [], selected: 'pwr', deviceName: 'Stages', connectState: 'connected' }
    const emptyControl = { capability: IncyclistCapability.Control, devices: [], selected: undefined }
    const emptyPower = { capability: IncyclistCapability.Power, devices: [], selected: undefined }
    const setPairingState = (state: Record<string, unknown>) => {
        pairing.getState.mockReturnValue({
            capabilities: [], interfaces: [{ name:'ble', enabled:true, state:'connected' }], canStartRide:false, ...state
        })
    }

    const labels = () => service.getPageDisplayProperties().buttons.map( (b: {label:string, primary:boolean}) => `${b.label}${b.primary?'*':''}`)

    beforeEach( ()=> {
        Inject('DevicePairing', pairing)
        Inject('AppState', appState)
        Inject('DeviceConfiguration', { getSimulatorAdapterId: jest.fn().mockReturnValue('sim') })
        Inject('DeviceAccess', { enrichWithAccessState: jest.fn( (i:unknown)=>i), getProtocols: jest.fn().mockReturnValue([]) })
        Inject('PairingVisitTracker', tracker)
        Inject('Bindings', { ui: { openPage: jest.fn() } })
        setSearch({})
        setPairingState({})

        service = create()
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
        Inject('Bindings', null)
        jest.clearAllMocks()
    })

    describe('while a search runs', ()=> {

        test('OK is not offered, even if what was found is enough to ride', ()=> {
            setSearch({ running:true, rideCapableFound:true, canStop:false })
            setPairingState({ capabilities:[emptyControl, power], canStartRide:true })

            expect(labels()).toEqual(['Skip*'])
            expect(service.getPageDisplayProperties().readyToStart).toBe(false)
        })

        test('Stop searching is offered once it is available, with Skip next to it', ()=> {
            setSearch({ running:true, rideCapableFound:true, canStop:true })
            setPairingState({ capabilities:[emptyControl, power], canStartRide:true })

            expect(labels()).toEqual(['Stop searching*', 'Skip'])
        })

        test('in ride mode, Stop searching comes with Cancel and without Simulate', ()=> {
            setSearch({ running:true, rideCapableFound:true, canStop:true })
            service.openPage(true)

            expect(labels()).toEqual(['Stop searching*', 'Cancel'])
        })

        test('Stop searching stops the search', ()=> {
            setSearch({ running:true, rideCapableFound:true, canStop:true })

            service.getPageDisplayProperties().buttons[0].onClick()

            expect(pairing.stopSearch).toHaveBeenCalled()
        })
    })

    describe('after a search that found nothing', ()=> {

        beforeEach( ()=> {
            setSearch({ ended:true, canSearchAgain:true, rideCapableFound:false })
            setPairingState({ capabilities:[emptyControl, emptyPower] })
        })

        test('Search again is the main action, with Skip next to it', ()=> {
            expect(labels()).toEqual(['Search again*', 'Skip'])
        })

        test('in ride mode, Search again comes with Simulate and Cancel', ()=> {
            service.openPage(true)
            expect(labels()).toEqual(['Search again*', 'Simulate', 'Cancel'])
        })

        test('the status line says the search finished with nothing found', ()=> {
            expect(service.getPageDisplayProperties().status.text).toMatch(/^Search finished, nothing found/)
        })

        test('empty ride tiles say "Not found", not "Searching…"', ()=> {
            const top = service.getPageDisplayProperties().capabilities.top
            top.forEach( (t: {emptyFooter?:string}) => expect(t.emptyFooter).toBe('Not found'))
        })

        test('Search again starts a new search', ()=> {
            service.getPageDisplayProperties().buttons[0].onClick()
            expect(pairing.searchAgain).toHaveBeenCalled()
        })

        test('Search again is not offered when nothing can search', ()=> {
            setPairingState({ capabilities:[emptyControl, emptyPower], interfaces:[{ name:'ble', enabled:true, state:'unavailable' }] })
            expect(labels()).not.toContain('Search again*')
            expect(labels()).not.toContain('Search again')
        })
    })

    describe('after a search that ended ready without a trainer', ()=> {

        test('OK is the main action, with Search again next to it', ()=> {
            setSearch({ ended:true, canSearchAgain:true, rideCapableFound:true })
            setPairingState({ capabilities:[emptyControl, power], canStartRide:true })

            expect(labels()).toEqual(['OK*', 'Search again'])
        })

        test('the empty Resistance tile invites a new search', ()=> {
            setSearch({ ended:true, canSearchAgain:true, rideCapableFound:true })
            setPairingState({ capabilities:[emptyControl, power], canStartRide:true })

            const control = service.getPageDisplayProperties().capabilities.top.find( (t: {capability:string}) => t.capability==='control')
            expect(control.emptyFooter).toBe('Not found · tap to search')
        })

        test('while the found device is still connecting, only today\'s buttons are offered', ()=> {
            setSearch({ ended:true, canSearchAgain:true, rideCapableFound:true })
            setPairingState({ capabilities:[emptyControl, { ...power, connectState:'connecting' }], canStartRide:false })

            expect(labels()).toEqual(['Skip*'])
        })
    })

    test('after a search that found a trainer, only OK is offered', ()=> {
        setSearch({ ended:true, canSearchAgain:false, rideCapableFound:true, trainerFound:true })
        setPairingState({ capabilities:[{ capability: IncyclistCapability.Control, devices: [], selected: 'neo', deviceName:'Neo', connectState:'connected' }], canStartRide:true })

        expect(labels()).toEqual(['OK*'])
    })

    describe('status line, row label and tiles while still looking', ()=> {

        const top = () => service.getPageDisplayProperties().capabilities.top
        const tile = (capability:string) => top().find( (t: {capability:string}) => t.capability===capability)

        test('the status line names what is still missing once Stop searching is offered', ()=> {
            setSearch({ running:true, rideCapableFound:true, canStop:true, missing:[IncyclistCapability.Control] })
            setPairingState({ capabilities:[emptyControl, power] })

            const props = service.getPageDisplayProperties()
            expect(props.status.id).toBe('S2w')
            expect(props.status.text).toMatch(/^Found Stages\. Still looking for a smart trainer/)
            expect(props.capabilities.rowLabels.top).toEqual({ text:'TO RIDE', subtext:'still looking for a trainer' })
        })

        test('before Stop searching is offered, the searching text and the usual row label stay', ()=> {
            setSearch({ running:true, rideCapableFound:true, canStop:false, missing:[IncyclistCapability.Control] })
            setPairingState({ capabilities:[emptyControl, power] })

            const props = service.getPageDisplayProperties()
            expect(props.status.id).not.toBe('S2w')
            expect(props.capabilities.rowLabels.top.subtext).not.toBe('still looking for a trainer')
        })

        test('with the trainer found, the row label says so', ()=> {
            setSearch({ running:true, rideCapableFound:true, trainerFound:true, canStop:true, missing:[IncyclistCapability.HeartRate] })
            setPairingState({ capabilities:[{ capability: IncyclistCapability.Control, devices: [], selected: 'neo', deviceName:'Neo', connectState:'connected' }] })

            expect(service.getPageDisplayProperties().capabilities.rowLabels.top).toEqual({ text:'TO RIDE', subtext:'trainer found' })
        })

        test('a device seen during the search but not started yet shows "Found"', ()=> {
            setSearch({ running:true, rideCapableFound:true, canStop:true, missing:[IncyclistCapability.Control] })
            setPairingState({ capabilities:[emptyControl, power], adapters:[{ udid:'pwr', adapter:{ isStarted:()=>false, getInterface:()=>'ble' } }] })

            expect(tile('power').stateText).toBe('Found')
            expect(tile('control').stateText).toBeUndefined()
        })

        test('a started device keeps its connect state during the search', ()=> {
            setSearch({ running:true, rideCapableFound:true, canStop:true, missing:[IncyclistCapability.Control] })
            setPairingState({ capabilities:[emptyControl, power], adapters:[{ udid:'pwr', adapter:{ isStarted:()=>true, getInterface:()=>'ble' } }] })

            expect(tile('power').stateText).toBeUndefined()
        })

        test('once the search has ended, no tile says "Found"', ()=> {
            setSearch({ ended:true, canSearchAgain:true, rideCapableFound:true })
            setPairingState({ capabilities:[emptyControl, power], canStartRide:true, adapters:[{ udid:'pwr', adapter:{ isStarted:()=>false, getInterface:()=>'ble' } }] })

            expect(tile('power').stateText).toBeUndefined()
        })

        test('after a search without a trainer, the ready line says no trainer was found', ()=> {
            setSearch({ ended:true, canSearchAgain:true, rideCapableFound:true })
            setPairingState({ capabilities:[emptyControl, power], canStartRide:true })

            expect(service.getPageDisplayProperties().status.id).toBe('S2e')
        })
    })
})
