/* eslint-disable @typescript-eslint/no-explicit-any */
import { FALLBACK_REVERTED_DISPLAY_MS, PairingGuidance, TRAINER_ATTEMPT_TIMEOUT_MS } from './guidance'
import type { PairingState, PairingStatusSource } from '../../../pairing'

const NOT_AVAILABLE = { reason:'not-available', scope:'until-next-pairing' } as const

type Trainer = { selected?:string, connectState?:string, excluded?:any }
type Meter = { selected?:string, connectState?:string, excluded?:any } | undefined

// a trainer in Resistance and Speed, and a separate power meter in Power
const stateWith = (trainer:Trainer = {}, meter:Meter = { connectState:'connected' }):PairingState => ({
    capabilities: [
        { capability:'control', selected:'trainer-1', interface:'ble', disabled:false, devices:[], deviceName:'Tacx Flux', deviceNames:'Tacx Flux', ...trainer } as any,
        { capability:'power', selected:'pm-1', interface:'ant', disabled:false, devices:[], deviceName:'Stages', deviceNames:'Stages', ...meter } as any,
        { capability:'speed', selected:'trainer-1', interface:'ble', disabled:false, devices:[], deviceName:'Tacx Flux', deviceNames:'Tacx Flux', connectState:trainer.connectState, excluded:trainer.excluded } as any,
    ]
})
const onFallback = (connectState='waiting', meter:Meter = { connectState:'connected' }) =>
    stateWith({ connectState, excluded:NOT_AVAILABLE }, meter)

const source = (state:PairingState, canStartRide=false):PairingStatusSource => ({
    platform: 'desktop',
    interfaces: [{ id:'ble', enabled:true, available:true }, { id:'ant', enabled:true, available:true }],
    capabilities: state.capabilities as any,
    canStartRide,
    loading: false,
    rideMode: false,
})

describe('PairingGuidance - riding without the trainer', ()=> {

    let guidance: PairingGuidance
    let log: jest.Mock
    let onChange: jest.Mock
    let configuration: { excludeDevice: jest.Mock, includeCapability: jest.Mock, getExclusions: jest.Mock }
    let exclusions: any[]

    const events = (message:string) => log.mock.calls.filter( ([m])=>m===message).map( ([,fields])=>fields)
    const statusId = (state:PairingState, canStartRide=false) => guidance.getStatus(source(state, canStartRide)).id

    // the trainer's first attempt failed while a separate power meter is connected
    const openUnavailable = (meter:Meter = { connectState:'connected' }) => {
        guidance.openVisit({ platform:'desktop' })
        guidance.onPairingState(stateWith({ connectState:'connecting' }, meter))
        guidance.onPairingState(stateWith({ connectState:'failed' }, meter))
        guidance.getStatus(source(stateWith({ connectState:'failed' }, meter)))
    }

    // what the configuration does when the trainer is excluded and the pairing state follows
    const chooseAndFollow = () => {
        const chosen = guidance.chooseFallback()
        guidance.onPairingState(onFallback())
        return chosen
    }

    beforeEach( ()=> {
        jest.useFakeTimers()
        log = jest.fn()
        onChange = jest.fn()
        exclusions = []
        configuration = {
            excludeDevice: jest.fn( (udid:string, opts:any)=>{
                ['control','power','speed'].forEach( capability=> exclusions.push({ capability, udid, ...opts, since:Date.now() }))
            }),
            includeCapability: jest.fn( (capability:string)=>{ exclusions = exclusions.filter( e=>e.capability!==capability) }),
            getExclusions: jest.fn( ()=>[...exclusions]),
        }
        guidance = new PairingGuidance({ log, onChange, configuration: ()=>configuration as any })
    })

    afterEach( ()=> {
        guidance.closeVisit()
        jest.useRealTimers()
        jest.clearAllMocks()
    })

    describe('the fallback candidate', ()=> {

        test('is a separate power meter that is connected', ()=> {
            openUnavailable()
            expect(guidance.getFallbackCandidate()).toBe('power')
        })

        test('is not there while the trainer is the only device to ride with', ()=> {
            openUnavailable({ selected:'trainer-1', connectState:'waiting' })
            expect(guidance.getFallbackCandidate()).toBeUndefined()
        })

        test('is not there while the separate device is not connected', ()=> {
            openUnavailable({ connectState:'connecting' })
            expect(guidance.getFallbackCandidate()).toBeUndefined()
        })

        test('is not offered while the trainer is still in its first attempt', ()=> {
            guidance.openVisit({ platform:'desktop' })
            guidance.onPairingState(stateWith({ connectState:'connecting' }))
            guidance.getStatus(source(stateWith({ connectState:'connecting' })))
            expect(guidance.getFallbackCandidate()).toBeUndefined()
        })
    })

    describe('chooseFallback()', ()=> {

        test('excludes the trainer until the next Pairing page visit', ()=> {
            openUnavailable()
            expect(guidance.chooseFallback()).toBe(true)
            expect(configuration.excludeDevice).toHaveBeenCalledWith('trainer-1', NOT_AVAILABLE)
        })

        test('the trainer stays unavailable while it is excluded, and the fallback is active', ()=> {
            openUnavailable()
            chooseAndFollow()

            expect(guidance.getState()).toMatchObject({ trainerPhase:'unavailable', pairingCase:'trainer-unavailable', fallback:{ capability:'power' } })
        })

        test('the ready status says the ride goes on the power meter, without resistance control', ()=> {
            openUnavailable()
            chooseAndFollow()

            const status = guidance.getStatus(source(onFallback(), true))
            expect(status).toMatchObject({ id:'S2b', text:'Ready to ride with your power meter, without resistance control, until you next open Devices.' })
        })

        test('is logged with the candidate and the time since the page opened', ()=> {
            openUnavailable()
            jest.advanceTimersByTime(4000)
            chooseAndFollow()

            expect(events('pairing fallback chosen')).toEqual([{ capability:'power', msSinceOpen:4000 }])
        })

        test('an open helper closes at once, as taken fallback', ()=> {
            openUnavailable()
            guidance.openHelper()
            guidance.selectReason('trainer_unavailable')
            chooseAndFollow()

            expect(guidance.getHelper().phase).toBe('hidden')
            expect(events('pairing helper action')).toEqual([expect.objectContaining({ action:'fallback_without_trainer', reason:'trainer_unavailable', fallbackCapability:'power' })])
            expect(events('pairing helper closed')).toEqual([expect.objectContaining({ via:'fallback' })])
            expect(events('pairing helper resolved')).toEqual([])
        })

        test('does nothing without a candidate', ()=> {
            openUnavailable({ selected:'trainer-1', connectState:'waiting' })
            expect(guidance.chooseFallback()).toBe(false)
            expect(configuration.excludeDevice).not.toHaveBeenCalled()
        })

        test('a failing configuration leaves the page as it was', ()=> {
            openUnavailable()
            configuration.excludeDevice.mockImplementation( ()=>{ throw new Error('boom') })

            expect(guidance.chooseFallback()).toBe(false)
            expect(guidance.getState().fallback).toBeUndefined()
            expect(events('pairing fallback chosen')).toEqual([])
        })

        test('the fallback device dropping before OK brings back the trainer status, and the fallback stays', ()=> {
            openUnavailable()
            chooseAndFollow()
            const dropped = onFallback('waiting', { connectState:'connecting' })
            guidance.onPairingState(dropped)

            expect(statusId(dropped, false)).toBe('S7')
            expect(guidance.getState().fallback).toEqual({ capability:'power' })
        })

        test('the page leaving says the fallback was active', ()=> {
            openUnavailable()
            chooseAndFollow()
            expect(guidance.getExitFields()).toMatchObject({ fallbackActive:true })
        })
    })

    describe('cancelFallback()', ()=> {

        test('takes the trainer back into use for every capability it was excluded from', ()=> {
            openUnavailable()
            chooseAndFollow()

            expect(guidance.cancelFallback()).toBe(true)
            expect(configuration.includeCapability.mock.calls.map( ([c])=>c)).toEqual(['control','power','speed'])
            expect(exclusions).toEqual([])
        })

        test('the trainer is still unavailable: the page goes back to waiting for it', ()=> {
            openUnavailable()
            chooseAndFollow()
            guidance.cancelFallback()
            guidance.onPairingState(stateWith({ connectState:'waiting' }))

            expect(guidance.getState()).toMatchObject({ trainerPhase:'unavailable', pairingCase:'trainer-unavailable' })
            expect(guidance.getState().fallback).toBeUndefined()
            expect(statusId(stateWith({ connectState:'waiting' }))).toBe('S7')
        })

        test('is logged as cancelled, not as reverted', ()=> {
            openUnavailable()
            jest.advanceTimersByTime(1000)
            chooseAndFollow()
            jest.advanceTimersByTime(3000)
            guidance.cancelFallback()

            expect(events('pairing fallback cancelled')).toEqual([{ capability:'power', msSinceOpen:4000, msSinceFallback:3000 }])
            expect(events('pairing fallback reverted')).toEqual([])
        })

        test('another device\'s exclusion is left alone', ()=> {
            openUnavailable()
            chooseAndFollow()
            exclusions.push({ capability:'heartrate', udid:'hrm-1', ...NOT_AVAILABLE, since:0 })

            guidance.cancelFallback()
            expect(exclusions.map( e=>e.udid)).toEqual(['hrm-1'])
        })

        test('does nothing without an active fallback', ()=> {
            openUnavailable()
            expect(guidance.cancelFallback()).toBe(false)
            expect(configuration.includeCapability).not.toHaveBeenCalled()
        })
    })

    describe('the trainer connecting while the fallback is active', ()=> {

        test('says resistance control is back on for a moment, then the usual ready status', ()=> {
            openUnavailable()
            chooseAndFollow()
            const connected = stateWith({ connectState:'connected' })
            guidance.onPairingState(connected)
            guidance.onFallbackReverted('trainer-1')

            expect(guidance.getStatus(source(connected, true))).toMatchObject({ id:'S2c', text:'Your trainer connected. Resistance control is back on.' })
            expect(guidance.getState()).toMatchObject({ trainerPhase:'connected' })
            expect(guidance.getState().fallback).toBeUndefined()

            jest.advanceTimersByTime(FALLBACK_REVERTED_DISPLAY_MS)
            expect(onChange).toHaveBeenCalled()
            expect(statusId(connected, true)).toBe('S2')
        })

        test('the revert of another device is not this fallback', ()=> {
            openUnavailable()
            chooseAndFollow()
            guidance.onFallbackReverted('someone-else')
            expect(statusId(onFallback(), true)).toBe('S2b')
        })
    })

    describe('a new visit', ()=> {

        test('starts without the fallback', ()=> {
            openUnavailable()
            chooseAndFollow()
            guidance.closeVisit()

            guidance.openVisit({ platform:'desktop' })
            guidance.onPairingState(stateWith({ connectState:'connecting' }))
            expect(guidance.getState().fallback).toBeUndefined()
            expect(guidance.getExitFields()).toMatchObject({ fallbackActive:false })
        })
    })

    describe('the rider\'s own attempt to reach the trainer', ()=> {

        const RETRY = 'pairing trainer retry'
        const RETRY_ENDED = 'pairing trainer retry ended'

        const startTileRetry = () => {
            const started = guidance.startRiderRetry({ trigger:'tile' })
            guidance.logRiderRetry(['control'])
            return started
        }

        test('starts only while the trainer is unavailable and no fallback is active', ()=> {
            guidance.openVisit({ platform:'desktop' })
            guidance.onPairingState(stateWith({ connectState:'connecting' }))
            expect(guidance.startRiderRetry({ trigger:'tile' })).toBe(false)

            guidance.onPairingState(stateWith({ connectState:'failed' }))
            guidance.getStatus(source(stateWith({ connectState:'failed' })))
            expect(chooseAndFollow()).toBe(true)
            expect(guidance.startRiderRetry({ trigger:'tile' })).toBe(false)

            guidance.cancelFallback()
            expect(guidance.startRiderRetry({ trigger:'tile' })).toBe(true)
        })

        test('while it runs, the status says the page is trying to reach the trainer, with the link', ()=> {
            openUnavailable()
            startTileRetry()

            expect(guidance.getStatus(source(stateWith({ connectState:'connecting' })))).toMatchObject({
                id:'S7a', text:'Trying to reach your trainer Tacx Flux…', link:'Not available today?', shortLink:'Not available?',
            })
            expect(guidance.getState()).toMatchObject({ trainerPhase:'unavailable', trainerRetry:'running' })
        })

        test('is logged once, with what it covers and what started it', ()=> {
            openUnavailable()
            jest.advanceTimersByTime(2000)
            startTileRetry()
            guidance.logRiderRetry(['control'])

            const logged = events(RETRY)
            expect(logged).toHaveLength(1)
            expect(logged[0]).toEqual({
                retryCapabilities:'control', trigger:'tile', retryIndex:1, msSinceUnavailable:2000,
                separateDeviceConnected:true, helperOpen:false, pairingCase:'trainer-unavailable', platform:'desktop',
            })
        })

        test('the trainer connecting ends it', ()=> {
            openUnavailable()
            startTileRetry()
            jest.advanceTimersByTime(3000)
            guidance.onPairingState(stateWith({ connectState:'connected' }))

            expect(guidance.getState().trainerRetry).toBeUndefined()
            expect(events(RETRY_ENDED)).toEqual([{ retryResult:'connected', durationMs:3000, retryIndex:1, pairingCase:'trainer-unavailable', platform:'desktop' }])
        })

        test('a failure left over from the attempt it joined does not end it', ()=> {
            openUnavailable()
            startTileRetry()
            guidance.onPairingState(stateWith({ connectState:'waiting' }))
            guidance.onPairingState(stateWith({ connectState:'failed' }))

            expect(guidance.getState().trainerRetry).toBe('running')
        })

        test('a failure after the trainer was seen connecting since the tap says it still can\'t be reached', ()=> {
            openUnavailable()
            startTileRetry()
            guidance.onPairingState(stateWith({ connectState:'connecting' }))
            guidance.onPairingState(stateWith({ connectState:'failed' }))

            expect(guidance.getStatus(source(stateWith({ connectState:'failed' })))).toMatchObject({
                id:'S7b', text:"Still can't reach your trainer Tacx Flux. Check it's switched on and not connected to another app.", link:'Not available today?',
            })
            expect(events(RETRY_ENDED)).toEqual([expect.objectContaining({ retryResult:'failed' })])
        })

        test('its timer running out says the same', ()=> {
            openUnavailable()
            startTileRetry()
            jest.advanceTimersByTime(TRAINER_ATTEMPT_TIMEOUT_MS.ble)

            expect(guidance.getState().trainerRetry).toBe('failed')
            expect(onChange).toHaveBeenCalled()
            expect(events(RETRY_ENDED)).toEqual([expect.objectContaining({ retryResult:'timeout', durationMs:TRAINER_ATTEMPT_TIMEOUT_MS.ble })])
        })

        test('the timer pauses while the page is in the background', ()=> {
            openUnavailable()
            startTileRetry()
            jest.advanceTimersByTime(10000)
            guidance.pauseVisit()
            jest.advanceTimersByTime(TRAINER_ATTEMPT_TIMEOUT_MS.ble * 2)
            expect(guidance.getState().trainerRetry).toBe('running')

            guidance.resumeVisit()
            jest.advanceTimersByTime(TRAINER_ATTEMPT_TIMEOUT_MS.ble - 10000)
            expect(guidance.getState().trainerRetry).toBe('failed')
        })

        test('leaving the page while it runs ends it as left_page', ()=> {
            openUnavailable()
            startTileRetry()
            guidance.closeVisit()

            expect(events(RETRY_ENDED)).toEqual([expect.objectContaining({ retryResult:'left_page' })])
        })

        test('the page leaving counts the rider\'s attempts', ()=> {
            openUnavailable()
            expect(guidance.getExitFields()).toMatchObject({ trainerRetries:0 })
            startTileRetry()
            expect(guidance.getExitFields()).toMatchObject({ trainerRetries:1 })
        })
    })
})
