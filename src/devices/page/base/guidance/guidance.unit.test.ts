/* eslint-disable @typescript-eslint/no-explicit-any */
import { PairingGuidance, TRAINER_ATTEMPT_TIMEOUT_MS } from './guidance'
import { PARTIAL_OUTAGE_DEBOUNCE_MS } from '../../../pairing'
import type { PairingState, PairingStatusSource } from '../../../pairing'

const PHASE_EVENT = 'pairing trainer phase changed'

type Trainer = { selected?:string, connectState?:string, interface?:string, disabled?:boolean, excluded?:any }

const stateWith = (trainer:Trainer = {}):PairingState => ({
    capabilities: [
        { capability:'control', selected:'trainer-1', interface:'ble', disabled:false, devices:[], deviceName:'Trainer', deviceNames:'Trainer', ...trainer } as any,
        { capability:'power', selected:'pm-1', connectState:'connected', interface:'ant', disabled:false, devices:[], deviceName:'PM', deviceNames:'PM' } as any,
    ]
})

const noTrainer = ():PairingState => stateWith({selected:undefined})

describe('PairingGuidance', ()=> {

    let guidance: PairingGuidance
    let log: jest.Mock
    let onChange: jest.Mock

    const phaseEvents = () => log.mock.calls.filter( ([message])=>message===PHASE_EVENT).map( ([,fields])=>fields)
    const open = (state:PairingState) => {
        guidance.openVisit()
        guidance.onPairingState(state)
    }

    beforeEach( ()=> {
        jest.useFakeTimers()
        log = jest.fn()
        onChange = jest.fn()
        guidance = new PairingGuidance({log, onChange})
    })

    afterEach( ()=> {
        guidance.closeVisit()
        jest.useRealTimers()
        jest.clearAllMocks()
    })

    describe('trainer configured', ()=> {

        test('no trainer selected is the no-trainer case, without a phase', ()=> {
            open(noTrainer())
            expect(guidance.getState()).toEqual({trainerConfigured:false, trainerPhase:undefined, pairingCase:'no-trainer'})
        })

        test('a switched-off Resistance tile with a remembered trainer is the no-trainer case', ()=> {
            open(stateWith({disabled:true, connectState:'waiting'}))
            expect(guidance.getState()).toEqual({trainerConfigured:false, trainerPhase:undefined, pairingCase:'no-trainer'})
        })

        test('an excluded trainer is the no-trainer case', ()=> {
            open(stateWith({excluded:{reason:'not-available', scope:'until-next-pairing'}, connectState:'waiting'}))
            expect(guidance.getState().pairingCase).toBe('no-trainer')
        })

        test('a switched-off Resistance tile never starts the attempt timer', ()=> {
            open(stateWith({disabled:true, connectState:'waiting'}))
            jest.advanceTimersByTime(60000)
            expect(phaseEvents()).toHaveLength(0)
        })
    })

    describe('visit open', ()=> {

        test('a trainer that is not connected yet is connecting', ()=> {
            open(stateWith({connectState:'waiting'}))
            expect(guidance.getState()).toEqual({trainerConfigured:true, trainerPhase:'connecting', pairingCase:'trainer-connecting'})
        })

        test('a trainer that is already connected is connected', ()=> {
            open(stateWith({connectState:'connected'}))
            expect(guidance.getState()).toEqual({trainerConfigured:true, trainerPhase:'connected', pairingCase:'trainer-connected'})
        })

        test('a failure left over from before the visit does not count as this attempt failing', ()=> {
            open(stateWith({connectState:'failed'}))
            expect(guidance.getState().trainerPhase).toBe('connecting')
        })

        test('the phase is only set once a pairing state has arrived', ()=> {
            guidance.openVisit()
            expect(guidance.getState().trainerPhase).toBeUndefined()
        })

        test('the initial phase is not logged as a change', ()=> {
            open(stateWith({connectState:'waiting'}))
            expect(phaseEvents()).toHaveLength(0)
        })
    })

    describe('connecting', ()=> {

        test('the trainer connecting moves it to connected', ()=> {
            open(stateWith({connectState:'waiting'}))
            jest.advanceTimersByTime(4000)
            guidance.onPairingState(stateWith({connectState:'connected'}))

            expect(guidance.getState().pairingCase).toBe('trainer-connected')
            expect(phaseEvents()).toEqual([{fromPhase:'connecting', toPhase:'connected', cause:'connected', attemptMs:4000, interface:'ble'}])
        })

        test('a pairing error for the trainer makes it unavailable', ()=> {
            open(stateWith({connectState:'connecting'}))
            jest.advanceTimersByTime(2500)
            guidance.onPairingState(stateWith({connectState:'failed'}))

            expect(guidance.getState().pairingCase).toBe('trainer-unavailable')
            expect(phaseEvents()).toEqual([{fromPhase:'connecting', toPhase:'unavailable', cause:'pair_error', attemptMs:2500, interface:'ble'}])
        })

        test('a pairing error stops the attempt timer, so it is not reported twice', ()=> {
            open(stateWith({connectState:'connecting'}))
            guidance.onPairingState(stateWith({connectState:'failed'}))
            jest.advanceTimersByTime(TRAINER_ATTEMPT_TIMEOUT_MS.ble*2)

            expect(phaseEvents()).toHaveLength(1)
            expect(phaseEvents()[0].cause).toBe('pair_error')
        })

        test.each([
            ['ble', 35000],
            ['ant', 15000],
            ['serial', 15000],
            ['tcpip', 15000],
            ['wifi', 15000],
        ])('over %s, the attempt times out after %d ms without a connect', (iface, timeout)=> {
            open(stateWith({connectState:'connecting', interface:iface}))

            jest.advanceTimersByTime(timeout-1)
            expect(guidance.getState().trainerPhase).toBe('connecting')

            jest.advanceTimersByTime(1)
            expect(guidance.getState().trainerPhase).toBe('unavailable')
            expect(phaseEvents()).toEqual([{fromPhase:'connecting', toPhase:'unavailable', cause:'timer', attemptMs:timeout, interface:iface}])
        })

        test('an interface without its own timeout uses the longest one', ()=> {
            open(stateWith({connectState:'connecting', interface:'simulator'}))
            jest.advanceTimersByTime(TRAINER_ATTEMPT_TIMEOUT_MS.ble-1)
            expect(guidance.getState().trainerPhase).toBe('connecting')
            jest.advanceTimersByTime(1)
            expect(guidance.getState().trainerPhase).toBe('unavailable')
        })

        test('the page is told when the timer moves the phase on', ()=> {
            open(stateWith({connectState:'connecting'}))
            onChange.mockClear()
            jest.advanceTimersByTime(TRAINER_ATTEMPT_TIMEOUT_MS.ble)
            expect(onChange).toHaveBeenCalledTimes(1)
        })

        test('the rider saying the trainer is not available makes it unavailable', ()=> {
            open(stateWith({connectState:'connecting'}))
            jest.advanceTimersByTime(1000)
            guidance.onTrainerUnavailable()

            expect(guidance.getState().pairingCase).toBe('trainer-unavailable')
            expect(phaseEvents()).toEqual([{fromPhase:'connecting', toPhase:'unavailable', cause:'rider', attemptMs:1000, interface:'ble'}])
            jest.advanceTimersByTime(TRAINER_ATTEMPT_TIMEOUT_MS.ble)
            expect(phaseEvents()).toHaveLength(1)
        })

        test('the rider saying the trainer is not available changes nothing once it is connected', ()=> {
            open(stateWith({connectState:'connected'}))
            guidance.onTrainerUnavailable()
            expect(guidance.getState().trainerPhase).toBe('connected')
            expect(phaseEvents()).toHaveLength(0)
        })
    })

    describe('unavailable', ()=> {

        test('stays unavailable through later retries', ()=> {
            open(stateWith({connectState:'connecting'}))
            guidance.onPairingState(stateWith({connectState:'failed'}))

            for (const connectState of ['waiting','connecting','failed','waiting','connecting']) {
                jest.advanceTimersByTime(2000)
                guidance.onPairingState(stateWith({connectState}))
                expect(guidance.getState().trainerPhase).toBe('unavailable')
            }
            jest.advanceTimersByTime(TRAINER_ATTEMPT_TIMEOUT_MS.ble)
            expect(phaseEvents()).toHaveLength(1)
        })

        test('the trainer connecting after all moves it to connected', ()=> {
            open(stateWith({connectState:'connecting'}))
            jest.advanceTimersByTime(TRAINER_ATTEMPT_TIMEOUT_MS.ble)
            jest.advanceTimersByTime(5000)
            guidance.onPairingState(stateWith({connectState:'connected'}))

            expect(guidance.getState().pairingCase).toBe('trainer-connected')
            expect(phaseEvents().at(-1)).toEqual({fromPhase:'unavailable', toPhase:'connected', cause:'connected', attemptMs:TRAINER_ATTEMPT_TIMEOUT_MS.ble+5000, interface:'ble'})
        })
    })

    describe('connected', ()=> {

        test('the trainer dropping moves it back to connecting and restarts the timer', ()=> {
            open(stateWith({connectState:'connected'}))
            guidance.onPairingState(stateWith({connectState:'waiting'}))

            expect(guidance.getState().pairingCase).toBe('trainer-connecting')
            expect(phaseEvents()).toEqual([{fromPhase:'connected', toPhase:'connecting', cause:'dropped', interface:'ble'}])

            jest.advanceTimersByTime(TRAINER_ATTEMPT_TIMEOUT_MS.ble)
            expect(guidance.getState().trainerPhase).toBe('unavailable')
            expect(phaseEvents().at(-1)).toMatchObject({fromPhase:'connecting', toPhase:'unavailable', cause:'timer', attemptMs:TRAINER_ATTEMPT_TIMEOUT_MS.ble})
        })

        test('a reconnect after a drop is a fresh attempt', ()=> {
            open(stateWith({connectState:'connecting'}))
            jest.advanceTimersByTime(3000)
            guidance.onPairingState(stateWith({connectState:'connected'}))
            jest.advanceTimersByTime(10000)
            guidance.onPairingState(stateWith({connectState:'waiting'}))
            jest.advanceTimersByTime(1500)
            guidance.onPairingState(stateWith({connectState:'connected'}))

            expect(phaseEvents().at(-1)).toMatchObject({fromPhase:'connecting', toPhase:'connected', attemptMs:1500})
        })

        test('repeated connected states are not logged again', ()=> {
            open(stateWith({connectState:'connected'}))
            guidance.onPairingState(stateWith({connectState:'connected'}))
            guidance.onPairingState(stateWith({connectState:'connected'}))
            expect(phaseEvents()).toHaveLength(0)
        })
    })

    describe('configuration changes during a visit', ()=> {

        test('switching off Resistance while connecting ends the phase and its timer', ()=> {
            open(stateWith({connectState:'connecting'}))
            guidance.onPairingState(stateWith({connectState:'connecting', disabled:true}))

            expect(guidance.getState()).toEqual({trainerConfigured:false, trainerPhase:undefined, pairingCase:'no-trainer'})
            jest.advanceTimersByTime(TRAINER_ATTEMPT_TIMEOUT_MS.ble)
            expect(phaseEvents()).toHaveLength(0)
        })

        test('selecting a trainer during the visit starts its attempt', ()=> {
            open(noTrainer())
            guidance.onPairingState(stateWith({connectState:'connecting', interface:'ant'}))

            expect(guidance.getState().trainerPhase).toBe('connecting')
            jest.advanceTimersByTime(TRAINER_ATTEMPT_TIMEOUT_MS.ant)
            expect(guidance.getState().trainerPhase).toBe('unavailable')
        })

        test('selecting a different trainer starts a new attempt, even after the previous one was unavailable', ()=> {
            open(stateWith({connectState:'connecting'}))
            guidance.onPairingState(stateWith({connectState:'failed'}))
            guidance.onPairingState(stateWith({selected:'trainer-2', connectState:'connecting'}))

            expect(guidance.getState().trainerPhase).toBe('connecting')
        })
    })

    describe('pause and resume', ()=> {

        test('the attempt timer does not run while the visit is paused', ()=> {
            open(stateWith({connectState:'connecting'}))
            jest.advanceTimersByTime(20000)
            guidance.pauseVisit()
            jest.advanceTimersByTime(120000)

            expect(guidance.getState().trainerPhase).toBe('connecting')
            expect(phaseEvents()).toHaveLength(0)
        })

        test('on resume, the timer runs for the time that was left', ()=> {
            open(stateWith({connectState:'connecting'}))
            jest.advanceTimersByTime(20000)
            guidance.pauseVisit()
            jest.advanceTimersByTime(120000)
            guidance.resumeVisit()

            jest.advanceTimersByTime(TRAINER_ATTEMPT_TIMEOUT_MS.ble-20000-1)
            expect(guidance.getState().trainerPhase).toBe('connecting')
            jest.advanceTimersByTime(1)
            expect(guidance.getState().trainerPhase).toBe('unavailable')
            expect(phaseEvents()).toEqual([expect.objectContaining({cause:'timer', attemptMs:TRAINER_ATTEMPT_TIMEOUT_MS.ble})])
        })

        test('pairing states arriving while paused are ignored', ()=> {
            open(stateWith({connectState:'connected'}))
            guidance.pauseVisit()
            guidance.onPairingState(stateWith({connectState:'paused'}))

            expect(guidance.getState().trainerPhase).toBe('connected')
            expect(phaseEvents()).toHaveLength(0)
        })

        test('the first pairing state after resume is evaluated again', ()=> {
            open(stateWith({connectState:'connected'}))
            guidance.pauseVisit()
            guidance.resumeVisit()
            guidance.onPairingState(stateWith({connectState:'waiting'}))

            expect(guidance.getState().trainerPhase).toBe('connecting')
        })

        test('time spent paused is not counted in the attempt', ()=> {
            open(stateWith({connectState:'connecting'}))
            jest.advanceTimersByTime(3000)
            guidance.pauseVisit()
            jest.advanceTimersByTime(60000)
            guidance.resumeVisit()
            jest.advanceTimersByTime(2000)
            guidance.onPairingState(stateWith({connectState:'connected'}))

            expect(phaseEvents()).toEqual([expect.objectContaining({cause:'connected', attemptMs:5000})])
        })
    })

    describe('closeVisit', ()=> {

        test('ends the phase and stops the attempt timer', ()=> {
            open(stateWith({connectState:'connecting'}))
            guidance.closeVisit()
            jest.advanceTimersByTime(TRAINER_ATTEMPT_TIMEOUT_MS.ble)

            expect(guidance.getState().trainerPhase).toBeUndefined()
            expect(phaseEvents()).toHaveLength(0)
        })

        test('pairing states after the visit closed are ignored', ()=> {
            open(stateWith({connectState:'connecting'}))
            guidance.closeVisit()
            guidance.onPairingState(stateWith({connectState:'connected'}))

            expect(guidance.getState().trainerPhase).toBeUndefined()
            expect(phaseEvents()).toHaveLength(0)
        })

        test('a new visit starts the trainer from scratch', ()=> {
            open(stateWith({connectState:'connecting'}))
            guidance.onPairingState(stateWith({connectState:'failed'}))
            guidance.closeVisit()
            open(stateWith({connectState:'connecting'}))

            expect(guidance.getState().trainerPhase).toBe('connecting')
        })
    })

    describe('logging', ()=> {

        test('the phase event carries only the listed keys, and no device id or name', ()=> {
            open(stateWith({connectState:'connecting'}))
            guidance.onPairingState(stateWith({connectState:'failed'}))

            const [fields] = phaseEvents()
            expect(Object.keys(fields).sort()).toEqual(['attemptMs','cause','fromPhase','interface','toPhase'])
            expect(JSON.stringify(fields)).not.toMatch(/trainer-1|Trainer/)
        })

        test('a failing logger does not break the phase change', ()=> {
            log.mockImplementation( ()=>{ throw new Error('log failed') })
            open(stateWith({connectState:'connecting'}))

            expect( ()=>guidance.onPairingState(stateWith({connectState:'failed'}))).not.toThrow()
            expect(guidance.getState().trainerPhase).toBe('unavailable')
        })
    })
})

describe('PairingGuidance - status line', ()=> {

    let guidance: PairingGuidance
    let log: jest.Mock
    let onChange: jest.Mock

    const OUTAGE_EVENT = 'pairing partial outage shown'
    const outageEvents = () => log.mock.calls.filter( ([message])=>message===OUTAGE_EVENT).map( ([,fields])=>fields)

    const antMissing: PairingStatusSource = {
        platform: 'desktop',
        interfaces: [{ id:'ant', enabled:true, available:false }, { id:'ble', enabled:true, available:true }],
        capabilities: [],
        canStartRide: false,
        loading: false,
        rideMode: false,
    }
    const antBack: PairingStatusSource = { ...antMissing, interfaces: [{ id:'ant', enabled:true, available:true }, { id:'ble', enabled:true, available:true }] }
    const bleOffMobile: PairingStatusSource = {
        ...antMissing,
        platform: 'mobile',
        interfaces: [{ id:'ble', enabled:true, available:false }, { id:'wifi', enabled:true, available:true }],
    }
    const withPowerMeter = (src:PairingStatusSource):PairingStatusSource => ({
        ...src, capabilities: [{ capability:'power', selected:'pm-1', deviceName:'PM', connectState:'connecting' }],
    })

    beforeEach( ()=> {
        jest.useFakeTimers()
        log = jest.fn()
        onChange = jest.fn()
        guidance = new PairingGuidance({log, onChange})
        guidance.openVisit({visitId:'visit-1'})
    })

    afterEach( ()=> {
        guidance.closeVisit()
        jest.useRealTimers()
        jest.clearAllMocks()
    })

    describe('first-use partial outage', ()=> {

        test('shows only once the outage has held for 2 s after the page got ready, and updates the page then', ()=> {
            expect(guidance.getStatus({...antMissing, loading:true}).id).toBe('S4')
            jest.advanceTimersByTime(5000)
            expect(guidance.getStatus(antMissing).id).toBe('S5')
            expect(onChange).not.toHaveBeenCalled()

            jest.advanceTimersByTime(PARTIAL_OUTAGE_DEBOUNCE_MS - 1)
            expect(guidance.getStatus(antMissing).id).toBe('S5')

            jest.advanceTimersByTime(1)
            expect(onChange).toHaveBeenCalledTimes(1)
            expect(guidance.getStatus(antMissing).id).toBe('S1b')
        })

        test('clears at once when the outage clears, and needs the full hold again when it comes back', ()=> {
            guidance.getStatus(antMissing)
            jest.advanceTimersByTime(PARTIAL_OUTAGE_DEBOUNCE_MS)
            expect(guidance.getStatus(antMissing).id).toBe('S1b')

            expect(guidance.getStatus(antBack).id).toBe('S5')
            expect(guidance.getStatus(antMissing).id).toBe('S5')
            jest.advanceTimersByTime(PARTIAL_OUTAGE_DEBOUNCE_MS)
            expect(guidance.getStatus(antMissing).id).toBe('S1b')
        })

        test('an outage that clears within the hold never shows, and no update fires for it', ()=> {
            guidance.getStatus(antMissing)
            jest.advanceTimersByTime(1000)
            guidance.getStatus(antBack)
            jest.advanceTimersByTime(PARTIAL_OUTAGE_DEBOUNCE_MS)

            expect(onChange).not.toHaveBeenCalled()
            expect(outageEvents()).toHaveLength(0)
        })

        test('never shows with any device selected', ()=> {
            guidance.getStatus(withPowerMeter(antMissing))
            jest.advanceTimersByTime(PARTIAL_OUTAGE_DEBOUNCE_MS * 2)

            expect(guidance.getStatus(withPowerMeter(antMissing)).id).toBe('S3')
            expect(onChange).not.toHaveBeenCalled()
        })

        test('a device selected after the outage started takes the hint away', ()=> {
            guidance.getStatus(antMissing)
            jest.advanceTimersByTime(PARTIAL_OUTAGE_DEBOUNCE_MS)
            expect(guidance.getStatus(withPowerMeter(antMissing)).id).toBe('S3')
            expect(guidance.getStatus({...antMissing, capabilities:[{ capability:'power', selected:'pm-1', deviceName:'PM', connectState:'waiting' }]}).id).toBe('S5')
        })

        test('is logged once per visit, when it first shows, without identifiers', ()=> {
            jest.advanceTimersByTime(1500)
            guidance.getStatus(bleOffMobile)
            jest.advanceTimersByTime(PARTIAL_OUTAGE_DEBOUNCE_MS)
            guidance.getStatus(bleOffMobile)
            guidance.getStatus(bleOffMobile)

            expect(outageEvents()).toEqual([{ visitId:'visit-1', platform:'mobile', interface:'ble', reason:'off', msSinceOpen:1500 + PARTIAL_OUTAGE_DEBOUNCE_MS }])
        })

        test('the reason says when Bluetooth is not allowed', ()=> {
            const denied = { ...bleOffMobile, interfaces: [{ id:'ble' as const, enabled:true, available:false, permissionDenied:true }, { id:'wifi' as const, enabled:true, available:true }] }
            guidance.getStatus(denied)
            jest.advanceTimersByTime(PARTIAL_OUTAGE_DEBOUNCE_MS)
            guidance.getStatus(denied)

            expect(outageEvents()[0]).toMatchObject({ interface:'ble', reason:'permission' })
        })

        test('the ANT+ reason is not-found', ()=> {
            guidance.getStatus(antMissing)
            jest.advanceTimersByTime(PARTIAL_OUTAGE_DEBOUNCE_MS)
            guidance.getStatus(antMissing)

            expect(outageEvents()[0]).toMatchObject({ platform:'desktop', interface:'ant', reason:'not-found' })
        })

        test('no outage is tracked outside a visit', ()=> {
            guidance.closeVisit()
            guidance.getStatus(antMissing)
            jest.advanceTimersByTime(PARTIAL_OUTAGE_DEBOUNCE_MS)

            expect(guidance.getStatus(antMissing).id).toBe('S5')
            expect(onChange).not.toHaveBeenCalled()
        })

        test('the hold stops while the app is in the background', ()=> {
            guidance.getStatus(antMissing)
            guidance.pauseVisit()
            jest.advanceTimersByTime(PARTIAL_OUTAGE_DEBOUNCE_MS)

            expect(onChange).not.toHaveBeenCalled()
        })
    })

    describe('the trainer', ()=> {

        test('the status follows the trainer phase', ()=> {
            const trainer = (connectState:string) => [{ capability:'control', selected:'trainer-1', deviceName:'Tacx Flux', connectState }]
            guidance.onPairingState({ capabilities:[{ capability:'control', selected:'trainer-1', interface:'ble', connectState:'connecting' } as any] })
            expect(guidance.getStatus({...antBack, capabilities:trainer('connecting')}).id).toBe('S3')

            guidance.onPairingState({ capabilities:[{ capability:'control', selected:'trainer-1', interface:'ble', connectState:'failed' } as any] })
            expect(guidance.getStatus({...antBack, capabilities:trainer('connecting')}).id).toBe('S7')
        })
    })

    describe('exit fields', ()=> {

        test('without anything shown', ()=> {
            guidance.getStatus(antBack)
            expect(guidance.getExitFields()).toEqual({ pairingCase:'no-trainer', partialOutageShown:false, switchedOffRequired:false, helperShown:false })
        })

        test('with the partial outage shown, even after it cleared', ()=> {
            guidance.getStatus(antMissing)
            jest.advanceTimersByTime(PARTIAL_OUTAGE_DEBOUNCE_MS)
            guidance.getStatus(antMissing)
            guidance.getStatus(antBack)

            expect(guidance.getExitFields()).toMatchObject({ partialOutageShown:true, partialOutageInterface:'ant', partialOutageReason:'not-found' })
        })

        test('with the trainer phase', ()=> {
            guidance.onPairingState({ capabilities:[{ capability:'control', selected:'trainer-1', interface:'ble', connectState:'connecting' } as any] })
            expect(guidance.getExitFields()).toMatchObject({ pairingCase:'trainer-connecting', trainerPhase:'connecting' })
        })

        test('switchedOffRequired while every required capability is switched off', ()=> {
            const off = (capability:string) => ({ capability, disabled:true })
            guidance.getStatus({...antBack, capabilities:[off('control'), off('power'), off('speed')]})
            expect(guidance.getExitFields().switchedOffRequired).toBe(true)

            guidance.getStatus(antBack)
            expect(guidance.getExitFields().switchedOffRequired).toBe(false)
        })
    })
})
