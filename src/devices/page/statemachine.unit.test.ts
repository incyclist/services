import { EventEmitter } from "node:stream"
import { Inject } from "../../base/decorators"
import { DevicePairingService } from "../pairing"
import { PairingPageStateMachine } from "./statemachine"
import { waitNextTick } from "../../utils"
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
        startPairing () {} 
        startScanning () {}
        stopPairing () {} 
        stopScanning () {}
       
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

        // should tigger a retry after a timeout of ~2s
        jest.advanceTimersByTime( 2100)
        expect(sm.state).toBe('Pairing')       


    })

    

})