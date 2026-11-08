/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'node:events'

import { Inject } from '../../../base/decorators/Injection'
import { Observer } from '../../../base/types'
import { DesktopPairingPageService } from '../desktop/service'
import { DevicesPageService } from '../mobile/service'
import { PARTIAL_OUTAGE_DEBOUNCE_MS } from '../../pairing'
import { HELPER_THRESHOLD_MS, TRAINER_ATTEMPT_TIMEOUT_MS } from './guidance'

type Trainer = { selected?:string, connectState?:string, interface?:string, disabled?:boolean }

const capabilitiesWith = (trainer:Trainer = {}) => [
    { capability:'control', selected:'trainer-1', interface:'ble', disabled:false, devices:[], deviceName:'Trainer', deviceNames:'Trainer', ...trainer },
    { capability:'power', selected:'trainer-1', connectState:trainer.connectState, interface:'ble', disabled:false, devices:[], deviceName:'Trainer', deviceNames:'Trainer' },
]

describe.each([
    ['mobile', ()=>new DevicesPageService()],
    ['desktop', ()=>new DesktopPairingPageService()],
])('%s pairing page - trainer phase and pairing case', (_platform, create)=> {

    let service: DevicesPageService|DesktopPairingPageService
    let pairing: any

    const stateMachine = {
        state: 'Idle',
        selectState: 'Inactive',
        start: jest.fn(),
        stop: jest.fn(),
        pause: jest.fn().mockResolvedValue(undefined),
        resume: jest.fn(),
    }

    const createPairing = () => {
        const emitter = new EventEmitter() as any
        emitter.getState = jest.fn().mockReturnValue({ capabilities:[], interfaces:[], canStartRide:false })
        emitter.start = jest.fn().mockResolvedValue(undefined)
        emitter.stop = jest.fn().mockResolvedValue(undefined)
        emitter.prepareStart = jest.fn().mockResolvedValue(undefined)
        emitter.setReadyToStart = jest.fn()
        emitter.setVisitOpen = jest.fn()
        emitter.getSearchStatus = jest.fn().mockReturnValue(undefined)
        return emitter
    }

    // what DevicePairingService does on every state change
    const emitPairingState = (trainer:Trainer) => {
        const capabilities = capabilitiesWith(trainer)
        pairing.getState.mockReturnValue({ capabilities, interfaces:[], canStartRide:false })
        pairing.emit('pairing-state', { capabilities, interfaces:[], canStartRide:false })
    }

    const props = () => service.getPageDisplayProperties()

    beforeEach( ()=> {
        jest.useFakeTimers()
        pairing = createPairing()
        Inject('DevicePairing', pairing)
        Inject('AppState', { setState: jest.fn(), getState: jest.fn(), getPersistedState: jest.fn() })
        Inject('DeviceConfiguration', { getSimulatorAdapterId: jest.fn().mockReturnValue('sim') })
        Inject('DeviceAccess', { enrichWithAccessState: jest.fn( (i:any)=>i) })
        Inject('Bindings', { ui: { openPage: jest.fn() } })
        Inject('PairingVisitTracker', { openVisit: jest.fn(), closeVisit: jest.fn(), setExitFields: jest.fn(), onBackground: jest.fn(), onForeground: jest.fn() })

        service = create()
        ;(service as any).stateMachine = stateMachine
        ;(service as any).isVisitOpen = false
        ;(service as any).moveTo = jest.fn()
    })

    afterEach( ()=> {
        service.closePage()
        ;(service as any).reset()
        Inject('DevicePairing', null)
        Inject('AppState', null)
        Inject('DeviceConfiguration', null)
        Inject('DeviceAccess', null)
        Inject('Bindings', null)
        Inject('PairingVisitTracker', null)
        jest.useRealTimers()
        jest.clearAllMocks()
    })

    test('a connecting trainer shows as trainer-connecting', ()=> {
        service.openPage(false)
        emitPairingState({connectState:'connecting'})

        expect(props()).toMatchObject({pairingCase:'trainer-connecting', trainerPhase:'connecting'})
    })

    test('without a trainer, the page is in the no-trainer case and has no phase', ()=> {
        service.openPage(false)
        emitPairingState({selected:undefined})

        expect(props().pairingCase).toBe('no-trainer')
        expect(props().trainerPhase).toBeUndefined()
    })

    test('a switched-off Resistance tile with a remembered trainer is the no-trainer case', ()=> {
        service.openPage(false)
        emitPairingState({disabled:true, connectState:'waiting'})

        expect(props().pairingCase).toBe('no-trainer')
    })

    test('a trainer that does not connect in time becomes unavailable, and the page is updated', ()=> {
        const observer:Observer = service.openPage(false) as Observer
        const onUpdate = jest.fn()
        observer.on('page-update', onUpdate)
        emitPairingState({connectState:'connecting'})

        jest.advanceTimersByTime(TRAINER_ATTEMPT_TIMEOUT_MS.ble)

        expect(props()).toMatchObject({pairingCase:'trainer-unavailable', trainerPhase:'unavailable'})
        expect(onUpdate).toHaveBeenCalled()
    })

    test('the trainer phase change is logged', ()=> {
        const logEvent = jest.spyOn(service as any, 'logEvent')
        service.openPage(false)
        emitPairingState({connectState:'connecting'})
        emitPairingState({connectState:'failed'})

        expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({message:'pairing trainer phase changed', fromPhase:'connecting', toPhase:'unavailable', cause:'pair_error'}))
    })

    test('the attempt timer is paused while the page is in the background', async ()=> {
        service.openPage(false)
        emitPairingState({connectState:'connecting'})
        jest.advanceTimersByTime(10000)

        await service.pausePage()
        jest.advanceTimersByTime(TRAINER_ATTEMPT_TIMEOUT_MS.ble*2)
        expect(props().trainerPhase).toBe('connecting')

        const resumed = service.resumePage()
        await jest.advanceTimersByTimeAsync(TRAINER_ATTEMPT_TIMEOUT_MS.ble-10000)
        await resumed
        expect(props().trainerPhase).toBe('unavailable')
    })

    test('a failing guidance update is logged and never reaches the pairing service', ()=> {
        const logError = jest.spyOn(service as any, 'logError')
        service.openPage(false)

        expect( ()=>pairing.emit('pairing-state', { capabilities: 42 })).not.toThrow()
        expect(logError).toHaveBeenCalledWith(expect.any(Error), 'onPairingState')
    })

    test('closing the page stops listening and stops the attempt timer', ()=> {
        service.openPage(false)
        emitPairingState({connectState:'connecting'})
        service.closePage()

        expect(pairing.listenerCount('pairing-state')).toBe(0)
        jest.advanceTimersByTime(TRAINER_ATTEMPT_TIMEOUT_MS.ble)
        expect(props().pairingCase).toBe('no-trainer')
    })

    test('opening the page twice does not listen twice', ()=> {
        service.openPage(false)
        service.openPage(false)

        expect(pairing.listenerCount('pairing-state')).toBe(1)
    })

    test('a new visit after the rider left re-evaluates the trainer from scratch', ()=> {
        service.openPage(false)
        emitPairingState({connectState:'connecting'})
        emitPairingState({connectState:'failed'})
        ;(service as any).onSkip()
        service.closePage()

        service.openPage(false)
        emitPairingState({connectState:'connecting'})

        expect(props().trainerPhase).toBe('connecting')
    })
})

describe.each([
    ['mobile', ()=>new DevicesPageService(), [{ name:'ble', state:'connected', enabled:true }, { name:'wifi', state:'connected', enabled:true }]],
    ['desktop', ()=>new DesktopPairingPageService(), [{ name:'ant', state:'connected', enabled:true }, { name:'ble', state:'connected', enabled:true }]],
])('%s pairing page - status line', (platform, create, interfacesUp)=> {

    let service: DevicesPageService|DesktopPairingPageService
    let pairing: any
    let tracker: any
    let interfaces: any[]

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

    const trainer = (connectState?:string) => ({ capability:'control', selected:'trainer-1', interface:'ble', disabled:false, devices:[], deviceName:'Tacx Flux', deviceNames:'Tacx Flux', connectState })
    const trainerPower = (connectState?:string) => ({ ...trainer(connectState), capability:'power' })
    const hrm = (connectState?:string) => ({ capability:'heartrate', selected:'hrm-1', interface:'ble', disabled:false, devices:[], deviceName:'HRM', deviceNames:'HRM', connectState })
    const switchedOff = (capability:string, deviceName?:string) => ({ capability, selected: deviceName ? `${capability}-1` : undefined, disabled:true, devices:[], deviceName, deviceNames:deviceName })

    const emit = (capabilities:any[], canStartRide=false) => {
        const state = { capabilities, interfaces, canStartRide }
        pairing.getState.mockReturnValue(state)
        pairing.emit('pairing-state', state)
    }
    const status = () => service.getPageDisplayProperties().status

    // openPage() is getting ready until its start() has settled
    const openReady = async () => {
        const observer = service.openPage(false)
        await jest.advanceTimersByTimeAsync(0)
        return observer
    }

    beforeEach( ()=> {
        jest.useFakeTimers()
        interfaces = interfacesUp.map( i=>({...i}))
        pairing = new EventEmitter() as any
        pairing.getState = jest.fn().mockReturnValue({ capabilities:[], interfaces, canStartRide:false })
        pairing.start = jest.fn().mockResolvedValue(undefined)
        pairing.stop = jest.fn().mockResolvedValue(undefined)
        pairing.prepareStart = jest.fn().mockResolvedValue(undefined)
        pairing.setReadyToStart = jest.fn()
        pairing.setVisitOpen = jest.fn()
        pairing.getSearchStatus = jest.fn().mockReturnValue(undefined)
        pairing.startDeviceSelection = jest.fn()
        pairing.stopDeviceSelection = jest.fn().mockResolvedValue(undefined)
        tracker = { openVisit: jest.fn().mockReturnValue({visitId:'visit-1'}), closeVisit: jest.fn(), setExitFields: jest.fn(), onBackground: jest.fn(), onForeground: jest.fn() }

        Inject('DevicePairing', pairing)
        Inject('AppState', { setState: jest.fn(), getState: jest.fn(), getPersistedState: jest.fn() })
        Inject('DeviceConfiguration', { getSimulatorAdapterId: jest.fn().mockReturnValue('sim') })
        Inject('DeviceAccess', { enrichWithAccessState: jest.fn( (i:any)=>i) })
        Inject('Bindings', { ui: { openPage: jest.fn() } })
        Inject('PairingVisitTracker', tracker)

        service = create()
        ;(service as any).stateMachine = stateMachine
        ;(service as any).isVisitOpen = false
        ;(service as any).moveTo = jest.fn()
    })

    afterEach( ()=> {
        service.closePage()
        ;(service as any).reset()
        Inject('DevicePairing', null)
        Inject('AppState', null)
        Inject('DeviceConfiguration', null)
        Inject('DeviceAccess', null)
        Inject('Bindings', null)
        Inject('PairingVisitTracker', null)
        jest.useRealTimers()
        jest.clearAllMocks()
    })

    describe('the trainer cannot be reached', ()=> {

        const makeUnavailable = () => {
            emit([trainer('connecting'), trainerPower('connecting')])
            jest.advanceTimersByTime(TRAINER_ATTEMPT_TIMEOUT_MS.ble)
        }

        test('the status line stays on the not-reachable text, with its link, through the trainer\'s retries', async ()=> {
            await openReady()
            makeUnavailable()

            const seen = []
            for (let i=0; i<4; i++) {
                for (const connectState of ['connecting','waiting','connecting']) {
                    emit([trainer(connectState), trainerPower(connectState)])
                    seen.push(status())
                    jest.advanceTimersByTime(2000)
                }
            }

            expect(seen).toHaveLength(12)
            for (const s of seen) {
                expect(s.id).toBe('S7')
                expect(s.text).toBe("Can't reach your trainer Tacx Flux. Pedal a few strokes to wake it up.")
                expect(s.link).toBe('Not available today?')
                expect(s.shortLink).toBe('Not available?')
            }
        })

        test('the status line stays on the not-reachable text while another selected device connects', async ()=> {
            await openReady()
            makeUnavailable()

            emit([trainer('waiting'), trainerPower('waiting'), hrm('connecting')])
            expect(status()).toMatchObject({ id:'S7', link:'Not available today?' })
        })

        test('while the trainer is still connecting, the same states show it connecting', async ()=> {
            await openReady()
            for (const connectState of ['connecting','waiting','connecting']) {
                emit([trainer(connectState), trainerPower(connectState)])
                expect(status()).toMatchObject({ id:'S3', text:'Connecting to your trainer Tacx Flux…' })
                expect(status().link).toBeUndefined()
                jest.advanceTimersByTime(2000)
            }
        })

        test('the trainer connecting ends it', async ()=> {
            await openReady()
            makeUnavailable()

            emit([trainer('connected'), trainerPower('connected')], true)
            expect(status().id).toBe('S2')
        })
    })

    describe('switched-off capabilities', ()=> {

        test('every required capability switched off', async ()=> {
            await openReady()
            emit([switchedOff('control','Tacx Flux'), switchedOff('power'), switchedOff('speed')])

            expect(status()).toMatchObject({ id:'S8', text:'Resistance, Power and Speed are all switched off. Switch one back on to ride.' })
        })

        test('ready on a power meter with Resistance switched off', async ()=> {
            await openReady()
            emit([switchedOff('control','Tacx Flux'), { capability:'power', selected:'pm-1', interface:'ant', disabled:false, devices:[], deviceName:'Stages', deviceNames:'Stages', connectState:'connected' }], true)

            expect(status()).toMatchObject({ id:'S2d', text:'Ready to ride with Stages, without resistance control (Resistance is switched off).' })
        })
    })

    describe('first-use partial outage', ()=> {

        const breakOne = () => {
            // mobile: Bluetooth off while Wi-Fi works; desktop: no ANT+ stick while Bluetooth works
            const broken = platform==='mobile' ? 'ble' : 'ant'
            interfaces = interfaces.map( i=> i.name===broken ? {...i, state:'unavailable'} : i)
        }

        test('shows 2 s after the page got ready, updates the page then, and is logged once', async ()=> {
            const logEvent = jest.spyOn(service as any, 'logEvent')
            breakOne()
            const observer = service.openPage(false) as Observer
            const onUpdate = jest.fn()
            observer.on('page-update', onUpdate)
            emit([])
            expect(status().id).toBe('S4')

            await jest.advanceTimersByTimeAsync(0)
            expect(status().id).toBe('S5')

            onUpdate.mockClear()
            jest.advanceTimersByTime(PARTIAL_OUTAGE_DEBOUNCE_MS)
            expect(onUpdate).toHaveBeenCalled()
            expect(status()).toMatchObject({ id:'S1b', dot:'amber' })
            status()

            const shown = logEvent.mock.calls.filter( ([e]:any)=>e.message==='pairing partial outage shown')
            expect(shown).toHaveLength(1)
            expect(shown[0][0]).toMatchObject({ visitId:'visit-1', platform, interface: platform==='mobile' ? 'ble' : 'ant' })
        })

        test('clears at once when the interface is back', async ()=> {
            breakOne()
            await openReady()
            emit([])
            status()
            jest.advanceTimersByTime(PARTIAL_OUTAGE_DEBOUNCE_MS)
            expect(status().id).toBe('S1b')

            interfaces = interfacesUp.map( i=>({...i}))
            emit([])
            expect(status().id).toBe('S5')
        })

        test('never shows for a rider with a saved device', async ()=> {
            breakOne()
            await openReady()
            emit([hrm('waiting')])
            status()
            jest.advanceTimersByTime(PARTIAL_OUTAGE_DEBOUNCE_MS * 3)

            expect(status().id).not.toBe('S1b')
        })

        test('the S1b copy is the one the platform shows', async ()=> {
            breakOne()
            await openReady()
            emit([])
            status()
            jest.advanceTimersByTime(PARTIAL_OUTAGE_DEBOUNCE_MS)

            if (platform==='mobile')
                expect(status()).toMatchObject({ text:"Bluetooth is off, so most trainers won't show up.", link:'Bluetooth settings' })
            else
                expect(status().text).toBe('ANT+ stick not found. If you use one, plug it in, try another USB port, or close other apps that use it.')
        })
    })

    describe('pairing page left', ()=> {

        test('the page gives the visit tracker its fields when the visit opens, and withdraws them when it ends', async ()=> {
            await openReady()
            makeUnavailableAndSkip()

            const provider = tracker.setExitFields.mock.calls[0][0]
            expect(typeof provider).toBe('function')
            expect(tracker.setExitFields).toHaveBeenLastCalledWith(undefined)
            // the fields as they stood when the tracker closed the visit
            expect(exitFieldsAtClose).toEqual({ pairingCase:'trainer-unavailable', trainerPhase:'unavailable', partialOutageShown:false, switchedOffRequired:false, helperShown:false })
        })

        let exitFieldsAtClose:any
        const makeUnavailableAndSkip = () => {
            tracker.closeVisit.mockImplementation( ()=>{ exitFieldsAtClose = tracker.setExitFields.mock.calls[0][0]() })
            emit([trainer('connecting'), trainerPower('connecting')])
            emit([trainer('failed'), trainerPower('failed')])
            status()
            ;(service as any).onSkip()
        }

        test('switchedOffRequired when the rider leaves with every required capability switched off', async ()=> {
            await openReady()
            tracker.closeVisit.mockImplementation( ()=>{ exitFieldsAtClose = tracker.setExitFields.mock.calls[0][0]() })
            emit([switchedOff('control'), switchedOff('power'), switchedOff('speed')])
            status()
            ;(service as any).onSkip()

            expect(exitFieldsAtClose).toMatchObject({ pairingCase:'no-trainer', switchedOffRequired:true })
        })

        test('helperShown and lastReason once the rider used the helper', async ()=> {
            await openReady()
            tracker.closeVisit.mockImplementation( ()=>{ exitFieldsAtClose = tracker.setExitFields.mock.calls[0][0]() })
            emit([])
            helper().onOpen()
            pickReason('asleep')
            ;(service as any).onSkip()

            expect(exitFieldsAtClose).toMatchObject({ helperShown:true, lastReason:'asleep' })
        })
    })

    const helper = () => service.getPageDisplayProperties().helper!
    const pickReason = (id:string) => helper().reasons.find( r=>r.id===id)!.onSelect()
    const threshold = HELPER_THRESHOLD_MS[platform as 'mobile'|'desktop']

    describe('helper', ()=> {

        test('opens by itself at the platform threshold with nothing found, and updates the page', async ()=> {
            const observer = await openReady() as Observer
            const onUpdate = jest.fn()
            observer.on('page-update', onUpdate)
            emit([])
            expect(helper().phase).toBe('hidden')

            jest.advanceTimersByTime(threshold)
            expect(onUpdate).toHaveBeenCalled()
            expect(helper()).toMatchObject({
                phase: 'open',
                title: "Can't find your trainer?",
                subline: "Pick what fits best and we'll show you what to try.",
                footer: 'Still searching. Your tiles light up as soon as something is found.',
            })
            expect(helper().tip).toBeUndefined()
            expect(helper().action).toBeUndefined()
        })

        test('offers the answers for the case, with the platform\'s wording', async ()=> {
            await openReady()
            emit([])
            helper().onOpen()

            expect(helper().reasons.map( r=>r.id)).toEqual(['asleep','other_app','interface','no_device','unsure'])
            expect(helper().reasons.find( r=>r.id==='interface')!.label)
                .toBe(platform==='mobile' ? "Bluetooth isn't working" : "Bluetooth or ANT+ isn't working")
        })

        test('a picked answer shows its tip, and the subline goes away', async ()=> {
            await openReady()
            emit([])
            helper().onOpen()
            pickReason('asleep')

            expect(helper().reasons.find( r=>r.id==='asleep')!.selected).toBe(true)
            expect(helper().subline).toBeUndefined()
            expect(helper().tip).toEqual({
                text: 'Most trainers and sensors go to sleep when idle. Pedal a few strokes or press a button on the device. We keep trying automatically.',
                shortText: 'Pedal a few strokes or press a button on it. We keep trying.',
            })
            expect(helper().action).toBeUndefined()
        })

        test('"no device" outside ride mode: the action is its own prop, and it browses routes', async ()=> {
            await openReady()
            emit([])
            helper().onOpen()
            pickReason('no_device')

            expect(helper().tip?.text).toBe("To ride, Incyclist needs a smart trainer, a power meter or a speed sensor. A heart-rate monitor or cadence sensor alone isn't enough.")
            expect(helper().action).toMatchObject({ label:'Browse routes for now', note:"You'll need one of these devices to start a ride." })

            helper().action!.onClick()
            expect(tracker.closeVisit).toHaveBeenCalledWith('skip', expect.anything())
        })

        test('"no device" in ride mode simulates', async ()=> {
            service.openPage(true)
            await jest.advanceTimersByTimeAsync(0)
            emit([])
            helper().onOpen()
            pickReason('no_device')

            expect(helper().action).toEqual({ label:'Ride with simulated power', onClick:expect.any(Function) })
            helper().action!.onClick()
            expect(tracker.closeVisit).toHaveBeenCalledWith('simulate', expect.anything())
        })

        test('the trainer case: its title and footer, and "not available today" once it is unavailable', async ()=> {
            await openReady()
            emit([trainer('connecting'), trainerPower('connecting')])
            helper().onOpen()
            expect(helper()).toMatchObject({ title:"Can't connect to your trainer?", footer:'Still trying to connect to your saved devices.' })
            expect(helper().reasons.map( r=>r.id)).not.toContain('trainer_unavailable')

            jest.advanceTimersByTime(TRAINER_ATTEMPT_TIMEOUT_MS.ble)
            pickReason('trainer_unavailable')
            expect(helper().tip?.text).toBe('To ride without your trainer, Incyclist needs a power meter or speed sensor, and none is connected. Have one? Tap the Power or Speed tile to add it.')
            expect(helper().action?.label).toBe('Browse routes for now')
        })

        test('waits while a device list is open, and opens once it closes', async ()=> {
            await openReady()
            emit([])
            ;(service as any).openDeviceSelection('control')
            jest.advanceTimersByTime(threshold)
            expect(helper().phase).toBe('hidden')

            ;(service as any).closeDeviceSelection()
            expect(helper().phase).toBe('open')
        })

        test('a device making the row ready resolves it', async ()=> {
            await openReady()
            emit([])
            helper().onOpen()
            emit([{ capability:'power', selected:'pm-1', interface:'ant', disabled:false, devices:[], deviceName:'Stages', deviceNames:'Stages', connectState:'connected' }], true)

            expect(helper()).toMatchObject({ phase:'resolved', resolvedText:'Found it! Ready to ride.' })
        })

        test('dismissing closes it', async ()=> {
            await openReady()
            emit([])
            helper().onOpen()
            helper().onDismiss()
            expect(helper().phase).toBe('hidden')
        })

        test('the threshold pauses while the page is in the background', async ()=> {
            await openReady()
            emit([])
            jest.advanceTimersByTime(5000)
            await service.pausePage()
            jest.advanceTimersByTime(threshold * 2)
            expect(helper().phase).toBe('hidden')

            const resumed = service.resumePage()
            await jest.advanceTimersByTimeAsync(threshold - 5000)
            await resumed
            expect(helper().phase).toBe('open')
        })

        test('restarts on every page open', async ()=> {
            await openReady()
            emit([])
            jest.advanceTimersByTime(threshold - 1000)
            service.closePage()

            await openReady()
            emit([])
            jest.advanceTimersByTime(threshold - 1)
            expect(helper().phase).toBe('hidden')
            jest.advanceTimersByTime(1)
            expect(helper().phase).toBe('open')
        })
    })
})
