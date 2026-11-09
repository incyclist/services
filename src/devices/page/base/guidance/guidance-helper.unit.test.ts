/* eslint-disable @typescript-eslint/no-explicit-any */
import { HELPER_RESOLVED_DISPLAY_MS, HELPER_THRESHOLD_MS, PairingGuidance, TRAINER_ATTEMPT_TIMEOUT_MS } from './guidance'
import type { PairingState, PairingStatusSource } from '../../../pairing'

const MOBILE_T = HELPER_THRESHOLD_MS.mobile

const searching: PairingStatusSource = {
    platform: 'mobile',
    interfaces: [{ id:'ble', enabled:true, available:true }, { id:'wifi', enabled:true, available:true }],
    capabilities: [],
    canStartRide: false,
    loading: false,
    rideMode: false,
}

const trainerState = (connectState:string):PairingState => ({
    capabilities: [{ capability:'control', selected:'trainer-1', interface:'ble', connectState, disabled:false, devices:[], deviceName:'Tacx Flux', deviceNames:'Tacx Flux' } as any],
})
const trainerSource = (connectState:string):PairingStatusSource => ({
    ...searching,
    capabilities: [{ capability:'control', selected:'trainer-1', deviceName:'Tacx Flux', connectState }],
})
const ready: PairingStatusSource = {
    ...searching,
    canStartRide: true,
    capabilities: [{ capability:'power', selected:'pm-1', deviceName:'Stages Power', connectState:'connected' }],
}

describe('PairingGuidance - helper', ()=> {

    let guidance: PairingGuidance
    let log: jest.Mock
    let onChange: jest.Mock

    const events = (message:string) => log.mock.calls.filter( ([m])=>m===message).map( ([,fields])=>fields)
    const phase = () => guidance.getHelper().phase

    const openVisit = (props:{platform?:'mobile'|'desktop', forRide?:boolean} = {}) => {
        guidance.openVisit({ visitId:'visit-1', platform:'mobile', forRide:false, ...props })
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

    describe('threshold timer', ()=> {

        test('the threshold is 30 s on mobile and 45 s on desktop', ()=> {
            expect(HELPER_THRESHOLD_MS).toEqual({ mobile:30000, desktop:45000 })
        })

        test('opens once the threshold has passed with nothing ready, and updates the page', ()=> {
            openVisit()
            guidance.getStatus(searching)

            jest.advanceTimersByTime(MOBILE_T - 1)
            expect(phase()).toBe('hidden')
            expect(onChange).not.toHaveBeenCalled()

            jest.advanceTimersByTime(1)
            expect(phase()).toBe('open')
            expect(onChange).toHaveBeenCalled()
        })

        test('uses the desktop threshold on desktop', ()=> {
            openVisit({platform:'desktop'})
            guidance.getStatus({...searching, platform:'desktop'})

            jest.advanceTimersByTime(MOBILE_T)
            expect(phase()).toBe('hidden')
            jest.advanceTimersByTime(HELPER_THRESHOLD_MS.desktop - MOBILE_T)
            expect(phase()).toBe('open')
        })

        test('the status line says "still searching" once the threshold has passed', ()=> {
            openVisit()
            expect(guidance.getStatus(searching).id).toBe('S5')
            jest.advanceTimersByTime(MOBILE_T)
            expect(guidance.getStatus(searching).id).toBe('S6')
        })

        test('pauses in the background and runs on for the time it had left', ()=> {
            openVisit()
            guidance.getStatus(searching)
            jest.advanceTimersByTime(10000)

            guidance.pauseVisit()
            jest.advanceTimersByTime(MOBILE_T * 3)
            expect(phase()).toBe('hidden')

            guidance.resumeVisit()
            jest.advanceTimersByTime(MOBILE_T - 10000 - 1)
            expect(phase()).toBe('hidden')
            jest.advanceTimersByTime(1)
            expect(phase()).toBe('open')
        })

        test('restarts on every page open', ()=> {
            openVisit()
            guidance.getStatus(searching)
            jest.advanceTimersByTime(MOBILE_T - 5000)
            guidance.closeVisit()

            openVisit()
            guidance.getStatus(searching)
            jest.advanceTimersByTime(MOBILE_T - 1)
            expect(phase()).toBe('hidden')
            jest.advanceTimersByTime(1)
            expect(phase()).toBe('open')
        })

        test('a helper dismissed in one visit opens again in the next', ()=> {
            openVisit()
            guidance.getStatus(searching)
            jest.advanceTimersByTime(MOBILE_T)
            guidance.dismissHelper()
            guidance.closeVisit()

            openVisit()
            guidance.getStatus(searching)
            jest.advanceTimersByTime(MOBILE_T)
            expect(phase()).toBe('open')
        })

        test('nothing runs outside a visit', ()=> {
            jest.advanceTimersByTime(MOBILE_T * 2)
            expect(phase()).toBe('hidden')
            expect(onChange).not.toHaveBeenCalled()
        })
    })

    describe('when it opens by itself', ()=> {

        test('not while the row is ready', ()=> {
            openVisit()
            guidance.getStatus(ready)
            jest.advanceTimersByTime(MOBILE_T)
            expect(phase()).toBe('hidden')
        })

        test('not while something to ride with was found and the search still looks for more', ()=> {
            openVisit()
            guidance.getStatus({...ready, canStartRide:false, stillLooking:true})
            jest.advanceTimersByTime(MOBILE_T)
            expect(phase()).toBe('hidden')
        })

        test('waits while a device list is open, and opens once it closes', ()=> {
            openVisit()
            guidance.getStatus(searching)
            guidance.setDeviceListOpen(true)
            jest.advanceTimersByTime(MOBILE_T)
            guidance.getStatus(searching)
            expect(phase()).toBe('hidden')

            guidance.setDeviceListOpen(false)
            guidance.getStatus(searching)
            expect(phase()).toBe('open')
        })

        test('not while every required capability is switched off', ()=> {
            const off = (capability:string) => ({ capability, disabled:true })
            const allOff = {...searching, capabilities:[off('control'), off('power'), off('speed')]}
            openVisit()
            guidance.getStatus(allOff)
            jest.advanceTimersByTime(MOBILE_T)
            guidance.getStatus(allOff)
            expect(phase()).toBe('hidden')
        })

        test('stays open when every required capability is switched off while it is open', ()=> {
            const off = (capability:string) => ({ capability, disabled:true })
            openVisit()
            guidance.getStatus(searching)
            jest.advanceTimersByTime(MOBILE_T)
            guidance.getStatus({...searching, capabilities:[off('control'), off('power'), off('speed')]})
            expect(phase()).toBe('open')
        })

        test('not again in the same visit once dismissed', ()=> {
            openVisit()
            guidance.getStatus(searching)
            jest.advanceTimersByTime(MOBILE_T)
            guidance.dismissHelper()
            guidance.setDeviceListOpen(true)
            guidance.setDeviceListOpen(false)
            guidance.getStatus(searching)
            expect(phase()).toBe('hidden')
        })
    })

    describe('with a trainer configured: max(threshold, trainer outcome)', ()=> {

        test('waits for the trainer attempt when it outlasts the threshold', ()=> {
            openVisit()
            guidance.onPairingState(trainerState('connecting'))
            guidance.getStatus(trainerSource('connecting'))

            jest.advanceTimersByTime(MOBILE_T)
            guidance.getStatus(trainerSource('connecting'))
            expect(phase()).toBe('hidden')

            jest.advanceTimersByTime(TRAINER_ATTEMPT_TIMEOUT_MS.ble - MOBILE_T)
            guidance.getStatus(trainerSource('connecting'))
            expect(phase()).toBe('open')
        })

        test('opens at the threshold when the trainer outcome came earlier', ()=> {
            openVisit()
            guidance.onPairingState(trainerState('connecting'))
            jest.advanceTimersByTime(5000)
            guidance.onPairingState(trainerState('failed'))
            guidance.getStatus(trainerSource('failed'))
            expect(phase()).toBe('hidden')

            jest.advanceTimersByTime(MOBILE_T - 5000)
            expect(phase()).toBe('open')
        })

        test('opens once a pairing error ends the attempt after the threshold', ()=> {
            openVisit()
            guidance.onPairingState(trainerState('connecting'))
            jest.advanceTimersByTime(MOBILE_T + 2000)
            expect(phase()).toBe('hidden')

            guidance.onPairingState(trainerState('failed'))
            guidance.getStatus(trainerSource('failed'))
            expect(phase()).toBe('open')
        })

        test('without a trainer, only the threshold counts', ()=> {
            openVisit()
            guidance.onPairingState({ capabilities:[] })
            guidance.getStatus(searching)
            jest.advanceTimersByTime(MOBILE_T)
            expect(phase()).toBe('open')
        })
    })

    describe('reasons', ()=> {

        test('without a trainer: "no device" second to last, the catch-all last', ()=> {
            openVisit()
            guidance.onPairingState({ capabilities:[] })
            expect(guidance.getHelper().reasons).toEqual(['asleep', 'other_app', 'interface', 'no_device', 'unsure'])
        })

        test('while the trainer is connecting: neither "no device" nor "not available today"', ()=> {
            openVisit()
            guidance.onPairingState(trainerState('connecting'))
            expect(guidance.getHelper().reasons).toEqual(['asleep', 'other_app', 'interface', 'unsure'])
        })

        test('once the trainer is unavailable: "not available today" instead of "no device"', ()=> {
            openVisit()
            guidance.onPairingState(trainerState('connecting'))
            guidance.onPairingState(trainerState('failed'))
            expect(guidance.getHelper().reasons).toEqual(['asleep', 'other_app', 'interface', 'trainer_unavailable', 'unsure'])
        })

        test('the list follows the trainer phase while the helper is open', ()=> {
            openVisit()
            guidance.onPairingState(trainerState('connecting'))
            guidance.openHelper()
            expect(guidance.getHelper().reasons).not.toContain('trainer_unavailable')

            jest.advanceTimersByTime(TRAINER_ATTEMPT_TIMEOUT_MS.ble)
            expect(guidance.getHelper().reasons).toContain('trainer_unavailable')
        })

        test('an answer that is not offered right now is ignored', ()=> {
            openVisit()
            guidance.onPairingState(trainerState('connecting'))
            guidance.openHelper()
            guidance.selectReason('trainer_unavailable')
            guidance.selectReason('no_device')

            expect(guidance.getHelper().selectedReason).toBeUndefined()
            expect(events('pairing helper reason selected')).toHaveLength(0)
        })

        test('the rider can switch answers', ()=> {
            openVisit()
            guidance.openHelper()
            guidance.selectReason('asleep')
            guidance.selectReason('interface')
            expect(guidance.getHelper().selectedReason).toBe('interface')
        })

        test('no answer can be picked while the helper is hidden', ()=> {
            openVisit()
            guidance.selectReason('asleep')
            expect(guidance.getHelper().selectedReason).toBeUndefined()
        })
    })

    describe('closing', ()=> {

        test('a device making the row ready resolves it, then it hides and the page updates', ()=> {
            openVisit()
            guidance.getStatus(searching)
            jest.advanceTimersByTime(MOBILE_T)
            onChange.mockClear()

            guidance.getStatus(ready)
            expect(phase()).toBe('resolved')

            jest.advanceTimersByTime(HELPER_RESOLVED_DISPLAY_MS)
            expect(phase()).toBe('hidden')
            expect(onChange).toHaveBeenCalled()
        })

        test('once resolved, it does not open by itself again in the visit', ()=> {
            openVisit()
            guidance.getStatus(searching)
            jest.advanceTimersByTime(MOBILE_T)
            guidance.getStatus(ready)
            jest.advanceTimersByTime(HELPER_RESOLVED_DISPLAY_MS)

            guidance.getStatus(searching)
            expect(phase()).toBe('hidden')
        })

        test('the link reopens it after it was dismissed', ()=> {
            openVisit()
            guidance.openHelper()
            guidance.dismissHelper()
            guidance.openHelper()
            expect(phase()).toBe('open')
        })

        test('opening it on request before the threshold works', ()=> {
            openVisit()
            guidance.getStatus(searching)
            guidance.openHelper()
            expect(phase()).toBe('open')
        })
    })

    describe('continue without a device', ()=> {

        test('in ride mode it simulates', ()=> {
            openVisit({forRide:true})
            expect(guidance.getContinueWithoutDeviceAction()).toEqual({ target:'simulate', label:'Ride with simulated power' })
            expect(guidance.continueWithoutDevice()).toBe('simulate')
        })

        test('outside ride mode it browses routes', ()=> {
            openVisit({forRide:false})
            expect(guidance.getContinueWithoutDeviceAction()).toEqual({ target:'skip', label:'Browse routes for now', note:"You'll need one of these devices to start a ride." })
            expect(guidance.continueWithoutDevice()).toBe('skip')
        })

        test('closes the helper', ()=> {
            openVisit()
            guidance.openHelper()
            guidance.continueWithoutDevice()
            expect(phase()).toBe('hidden')
        })
    })

    describe('separate sensor', ()=> {

        test('a connected power meter that is not the trainer is a separate sensor', ()=> {
            openVisit()
            guidance.onPairingState(trainerState('connecting'))
            guidance.getStatus({...trainerSource('connecting'), capabilities:[
                { capability:'control', selected:'trainer-1', deviceName:'Tacx Flux', connectState:'connecting' },
                { capability:'power', selected:'pm-1', deviceName:'Stages Power', connectState:'connected' },
            ]})
            expect(guidance.getHelper().separateSensor).toBe('power')
        })

        test('the trainer acting as power meter is not', ()=> {
            openVisit()
            guidance.onPairingState(trainerState('connecting'))
            guidance.getStatus({...trainerSource('connecting'), capabilities:[
                { capability:'control', selected:'trainer-1', deviceName:'Tacx Flux', connectState:'connecting' },
                { capability:'power', selected:'trainer-1', deviceName:'Tacx Flux', connectState:'connected' },
            ]})
            expect(guidance.getHelper().separateSensor).toBeUndefined()
        })
    })

    describe('events', ()=> {

        const IDENTIFIERS = /trainer-1|pm-1|hrm-1|Tacx|Stages|HRM Pro|udid|deviceName|[0-9a-f]{2}(:[0-9a-f]{2}){5}/i
        const expectNoIdentifiers = () => {
            log.mock.calls.forEach( ([,fields])=> {
                Object.entries(fields).forEach( ([key,value])=> {
                    expect(['string','number','boolean']).toContain(typeof value)
                    expect(`${key}=${value}`).not.toMatch(IDENTIFIERS)
                })
            })
        }
        const keys = (message:string) => events(message).map( f=>Object.keys(f).sort((a,b)=>a.localeCompare(b)))
        const sorted = (k:string[]) => [...k].sort((a,b)=>a.localeCompare(b))

        const withPowerMeter: PairingStatusSource = {...searching, capabilities:[
            { capability:'control', selected:'trainer-1', deviceName:'Tacx Flux', connectState:'connecting' },
            { capability:'heartrate', selected:'hrm-1', deviceName:'HRM Pro', connectState:'connected' },
        ]}

        test('shown by the timer', ()=> {
            openVisit()
            guidance.onPairingState(trainerState('connecting'))
            guidance.getStatus(withPowerMeter)
            jest.advanceTimersByTime(TRAINER_ATTEMPT_TIMEOUT_MS.ble)
            guidance.getStatus(withPowerMeter)

            expect(events('pairing helper shown')).toEqual([{
                visitId:'visit-1', trigger:'timer', elapsedMs:TRAINER_ATTEMPT_TIMEOUT_MS.ble, thresholdMs:MOBILE_T,
                platform:'mobile', forRide:false, connectedCapabilities:'heartrate', interfaceStates:'ble:available,wifi:available',
                pairingCase:'trainer-unavailable', trainerPhase:'unavailable', trainerConfigured:true,
            }])
            expectNoIdentifiers()
        })

        test('shown from the link, without a trainer', ()=> {
            openVisit()
            guidance.getStatus(searching)
            jest.advanceTimersByTime(3000)
            guidance.openHelper()

            expect(events('pairing helper shown')).toEqual([{
                visitId:'visit-1', trigger:'link', elapsedMs:3000, thresholdMs:MOBILE_T, platform:'mobile', forRide:false,
                connectedCapabilities:'', interfaceStates:'ble:available,wifi:available', pairingCase:'no-trainer', trainerConfigured:false,
            }])
        })

        test('shown from the link while the trainer is unavailable', ()=> {
            openVisit()
            guidance.onPairingState(trainerState('connecting'))
            guidance.onPairingState(trainerState('failed'))
            guidance.openHelper()
            expect(events('pairing helper shown')[0].trigger).toBe('trainer_unavailable_link')
        })

        test('the elapsed time leaves out the time in the background', ()=> {
            openVisit()
            jest.advanceTimersByTime(4000)
            guidance.pauseVisit()
            jest.advanceTimersByTime(60000)
            guidance.resumeVisit()
            jest.advanceTimersByTime(1000)
            guidance.openHelper()
            expect(events('pairing helper shown')[0].elapsedMs).toBe(5000)
        })

        test('reason selected', ()=> {
            openVisit()
            guidance.getStatus(withPowerMeter)
            guidance.openHelper()
            jest.advanceTimersByTime(2000)
            guidance.selectReason('asleep')
            guidance.selectReason('no_device')

            expect(keys('pairing helper reason selected')).toEqual([
                sorted(['visitId','reason','selectionIndex','elapsedMs','connectedCapabilities','interfaceStates','pairingCase','trainerConfigured']),
                sorted(['visitId','reason','selectionIndex','elapsedMs','connectedCapabilities','interfaceStates','pairingCase','trainerConfigured']),
            ])
            expect(events('pairing helper reason selected').map( e=>[e.reason, e.selectionIndex])).toEqual([['asleep',1], ['no_device',2]])
            expect(events('pairing helper reason selected')[0]).toMatchObject({ elapsedMs:2000, connectedCapabilities:'heartrate' })
            expectNoIdentifiers()
        })

        test('continue without a device: the action, then the close', ()=> {
            openVisit({forRide:true})
            guidance.openHelper()
            jest.advanceTimersByTime(1500)
            guidance.selectReason('no_device')
            guidance.continueWithoutDevice()

            expect(events('pairing helper action')).toEqual([{
                visitId:'visit-1', action:'continue_without_device', reason:'no_device', continueTarget:'simulate',
                pairingCase:'no-trainer', trainerConfigured:false,
            }])
            expect(events('pairing helper closed')).toEqual([{
                visitId:'visit-1', via:'continue_without_device', msSinceShown:1500, lastReason:'no_device',
                pairingCase:'no-trainer', trainerConfigured:false,
            }])
        })

        test('no action is logged while the helper is hidden', ()=> {
            openVisit()
            guidance.continueWithoutDevice()
            expect(events('pairing helper action')).toHaveLength(0)
            expect(events('pairing helper closed')).toHaveLength(0)
        })

        test('dismissed', ()=> {
            openVisit()
            guidance.openHelper()
            jest.advanceTimersByTime(700)
            guidance.dismissHelper()

            expect(events('pairing helper closed')).toEqual([{
                visitId:'visit-1', via:'dismiss', msSinceShown:700, pairingCase:'no-trainer', trainerConfigured:false,
            }])
        })

        test('page left while open', ()=> {
            openVisit()
            guidance.onPairingState(trainerState('connecting'))
            guidance.openHelper()
            jest.advanceTimersByTime(900)
            guidance.closeVisit()

            expect(events('pairing helper closed')).toEqual([{
                visitId:'visit-1', via:'page_left', msSinceShown:900, pairingCase:'trainer-connecting', trainerPhase:'connecting', trainerConfigured:true,
            }])
        })

        test('page left while hidden logs no close', ()=> {
            openVisit()
            guidance.closeVisit()
            expect(events('pairing helper closed')).toHaveLength(0)
        })

        test('resolved, with the capability that made the row ready', ()=> {
            openVisit()
            guidance.getStatus(searching)
            guidance.openHelper()
            guidance.selectReason('asleep')
            jest.advanceTimersByTime(4000)
            guidance.getStatus(ready)

            expect(events('pairing helper resolved')).toEqual([{
                visitId:'visit-1', msSinceShown:4000, lastReason:'asleep', capability:'power', pairingCase:'no-trainer', trainerConfigured:false,
            }])
            expect(events('pairing helper closed')).toHaveLength(0)
            expectNoIdentifiers()
        })

        test('resolved is logged once', ()=> {
            openVisit()
            guidance.openHelper()
            guidance.getStatus(ready)
            guidance.getStatus(ready)
            jest.advanceTimersByTime(HELPER_RESOLVED_DISPLAY_MS)
            guidance.getStatus(ready)
            expect(events('pairing helper resolved')).toHaveLength(1)
        })
    })

    describe('exit fields', ()=> {

        test('helper not shown', ()=> {
            openVisit()
            expect(guidance.getExitFields()).toMatchObject({ helperShown:false })
            expect(guidance.getExitFields()).not.toHaveProperty('lastReason')
        })

        test('helper shown, with the last answer picked', ()=> {
            openVisit()
            guidance.openHelper()
            guidance.selectReason('other_app')
            guidance.dismissHelper()
            expect(guidance.getExitFields()).toMatchObject({ helperShown:true, lastReason:'other_app' })
        })

        test('start from scratch on the next visit', ()=> {
            openVisit()
            guidance.openHelper()
            guidance.selectReason('other_app')
            guidance.closeVisit()
            openVisit()
            expect(guidance.getExitFields()).toMatchObject({ helperShown:false })
            expect(guidance.getExitFields()).not.toHaveProperty('lastReason')
        })
    })
})
