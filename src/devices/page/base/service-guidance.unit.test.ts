/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'node:events'

import { Inject } from '../../../base/decorators/Injection'
import { Observer } from '../../../base/types'
import { DesktopPairingPageService } from '../desktop/service'
import { DevicesPageService } from '../mobile/service'
import { TRAINER_ATTEMPT_TIMEOUT_MS } from './guidance'

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
        Inject('PairingVisitTracker', { openVisit: jest.fn(), closeVisit: jest.fn(), onBackground: jest.fn(), onForeground: jest.fn() })

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
