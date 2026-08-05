import { EventEmitter } from "node:stream"
import { Inject } from "../../base/decorators"
import { DevicePairingService } from "../pairing"
import { PairingPageStateMachine } from "./statemachine"
import { DeviceConfigurationService } from "../configuration"

describe('PairingPage state machine',()=> {

    let sm: PairingPageStateMachine


    class MockPairingService extends EventEmitter {

        constructor() {
            super()
        }
        pairingSuccess: boolean = true
        pairingComplete: boolean = false

        checkPairingSuccess () { return this.pairingSuccess}
        checkPairingComplete () { return this.pairingComplete}
        prepareForRide () {}
        async startPairing () {}
        async startScanning () {}
        async stopPairing () {}
        async stopScanning () {}

    }

    

    
    const pairingMock = new MockPairingService()
    const configMock: Partial<DeviceConfigurationService> = {
        canStartRide: jest.fn(),
        getAdapters: jest.fn()
    }

    const setupMocks = ()=> {
        Inject('DevicePairing', pairingMock)
        Inject('DeviceConfiguration',configMock)
        jest.useFakeTimers()

    }

    const cleanupMocks = ()=> {
        Inject('DevicePairing',null)
        Inject('DeviceConfiguration',null)
        jest.useRealTimers()
    }

    beforeEach( ()=> {
        sm = new PairingPageStateMachine()
    })

    afterEach( ()=> {
        cleanupMocks()
    })

    test('no devices should trigger scan',async ()=> {
        setupMocks()

        let callBack = jest.fn()

        sm.start(callBack);       
        expect(sm.state).toBe('Idle')

        // simulate an unsuccessfull pairing attempt
        configMock.canStartRide = jest.fn().mockReturnValue(false)        

        sm.onPageReady()        
        expect(sm.state).toBe('Scanning')       
    })


    test('has devices should trigger pairing',async ()=> {
        setupMocks()

        let callBack = jest.fn()

        sm.start(callBack);
        
        expect(sm.state).toBe('Idle')

        // simulate an unsuccessfull pairing attempt
        configMock.canStartRide = jest.fn().mockReturnValue(true)        
        configMock.getAdapters = jest.fn().mockReturnValue([])        
        pairingMock.pairingSuccess = false
        pairingMock.pairingComplete = false

        sm.onPageReady()        
        expect(sm.state).toBe('Pairing')       
    })


    test('pairing failed should retry pairing',async ()=> {
        setupMocks()

        let callBack = jest.fn()

        // simulate an unsuccessfull pairing attempt
        configMock.canStartRide = jest.fn().mockReturnValue(true)        
        pairingMock.pairingSuccess = false
        pairingMock.pairingComplete = false

        sm.start(callBack);
        sm.onPageReady()        

        // Now let's imulate the events of a failed pairing attempt
        pairingMock.emit('pairing-start')       
        expect(sm.state).toBe('Pairing')
        pairingMock.emit('pairing-done')
        expect(sm.state).toBe('Idle')

        // let the (already resolved) startPairing() call's cleanup microtask run, so its
        // in-flight marker is cleared before the retry is allowed to kick off a new attempt
        await (sm as any).pairingPromise

        // should tigger a retry after a timeout of ~2s
        jest.advanceTimersByTime( 2100)
        expect(sm.state).toBe('Pairing')


    })

    test('overlapping onDeviceSelectionClosed() calls before startPairing() resolves should not get the state machine stuck in Pairing',async ()=> {
        setupMocks()

        const callback = jest.fn()

        configMock.canStartRide = jest.fn().mockReturnValue(true)
        configMock.getAdapters = jest.fn().mockReturnValue([])
        pairingMock.pairingSuccess = true
        pairingMock.pairingComplete = false

        // simulate a startPairing() call that doesn't resolve immediately - this mirrors
        // the real DevicePairingService.startPairing(), which stays pending until the
        // adapters have (dis)connected
        let startPairingCalls = 0
        let resolveStartPairing: ()=>void
        pairingMock.startPairing = jest.fn().mockImplementation( ()=> {
            startPairingCalls++
            return new Promise<void>( resolve => { resolveStartPairing = resolve })
        })
        pairingMock.stopPairing = jest.fn().mockResolvedValue(undefined)

        const logSpy = jest.spyOn( (sm as any).logger,'logEvent')

        sm.start(callback)
        sm.onPageReady()

        expect(sm.state).toBe('Pairing')
        expect(startPairingCalls).toBe(1)

        // simulate the device-selection list being opened/closed multiple times in quick
        // succession (e.g. a user toggling it) while the first startPairing() call is
        // still in flight. Before the fix, every call re-triggered performCheck() ->
        // startPairing(), causing several overlapping pairing attempts to race each other.
        await sm.onDeviceSelectionClosed()
        await sm.onDeviceSelectionClosed()
        await sm.onDeviceSelectionClosed()

        // only the original, still in-flight startPairing() call should exist - no
        // overlapping attempts should have been triggered
        expect(startPairingCalls).toBe(1)

        // the in-flight pairing attempt now finishes, as it would in the real service.
        // Await the state machine's own tracking promise (rather than jest's fake-timer
        // sensitive waitNextTick()) to let its cleanup ('finally') microtask run.
        const pendingPairing = (sm as any).pairingPromise
        resolveStartPairing()
        pairingMock.emit('pairing-done')
        await pendingPairing

        // the state machine must have returned to Idle, not be stuck in Pairing
        expect(sm.state).toBe('Idle')

        // no illegal-state errors should have been logged along the way
        const illegalStateErrors = logSpy.mock.calls.filter( ([evt]:[any]) => evt.message==='error')
        expect(illegalStateErrors).toHaveLength(0)

        // a fresh session must be startable without issues afterwards
        sm.stop()
        const callback2 = jest.fn()
        sm.start(callback2)
        expect(sm.state).toBe('Idle')
    })

})