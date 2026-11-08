/* eslint-disable @typescript-eslint/no-explicit-any */
import { PairingGuidance, TRAINER_ATTEMPT_TIMEOUT_MS } from './guidance'
import type { PairingState } from '../../../pairing'

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
