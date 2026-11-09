/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'node:events'

import { Inject } from '../../../base/decorators/Injection'
import { DesktopPairingPageService } from '../desktop/service'
import { DevicesPageService } from '../mobile/service'
import { TRAINER_ATTEMPT_TIMEOUT_MS } from './guidance'

// Switching off the Resistance tile while the configured trainer connects or can't be reached means
// "my trainer isn't available today", not "stop using my trainer": the helper opens with that answer
// picked, and nothing is switched off. In every other case, the switch turns the capability off.
describe.each([
    ['mobile', ()=>new DevicesPageService()],
    ['desktop', ()=>new DesktopPairingPageService()],
])('%s pairing page - switching off Resistance', (_platform, create)=> {

    let service: DevicesPageService|DesktopPairingPageService
    let pairing: any

    const stateMachine = {
        state: 'Idle', selectState: 'Inactive',
        start: jest.fn(), stop: jest.fn(), pause: jest.fn().mockResolvedValue(undefined), resume: jest.fn(),
        onDeviceSelectionOpened: jest.fn(), onDeviceSelectionClosed: jest.fn(),
    }

    const capability = (name:string, selected:string|undefined, connectState?:string, deviceName='Tacx Flux') =>
        ({ capability:name, selected, interface:'ble', disabled:false, devices:[], deviceName, deviceNames:deviceName, connectState })

    const emit = (capabilities:any[], canStartRide=false) => {
        const state = { capabilities, interfaces:[{ name:'ble', state:'connected', enabled:true }], canStartRide }
        pairing.getState.mockReturnValue(state)
        pairing.emit('pairing-state', state)
    }
    const trainerIs = (connectState:string, canStartRide=false) =>
        emit([capability('control','trainer-1',connectState), capability('power','trainer-1',connectState)], canStartRide)

    const props = () => service.getPageDisplayProperties()
    const tile = (name:string) => [...props().capabilities!.top, ...props().capabilities!.bottom].find( t=>t.capability===name)!
    const helper = () => props().helper!
    const logged = (message:string) => (service as any).logEvent.mock.calls.map( ([e]:any)=>e).filter( (e:any)=>e?.message===message)

    const open = async () => {
        service.openPage(false)
        await jest.advanceTimersByTimeAsync(0)
    }

    beforeEach( ()=> {
        jest.useFakeTimers()
        pairing = new EventEmitter() as any
        pairing.getState = jest.fn().mockReturnValue({ capabilities:[], interfaces:[], canStartRide:false })
        pairing.start = jest.fn().mockResolvedValue(undefined)
        pairing.stop = jest.fn().mockResolvedValue(undefined)
        pairing.setVisitOpen = jest.fn()
        pairing.getSearchStatus = jest.fn().mockReturnValue(undefined)
        pairing.getPendingConflicts = jest.fn().mockReturnValue([])
        pairing.unselectDevices = jest.fn().mockResolvedValue(undefined)

        Inject('DevicePairing', pairing)
        Inject('DeviceConfiguration', { getSimulatorAdapterId: jest.fn().mockReturnValue('sim') })
        Inject('AppState', { setState: jest.fn(), getState: jest.fn(), getPersistedState: jest.fn() })
        Inject('DeviceAccess', { enrichWithAccessState: jest.fn( (i:any)=>i) })
        Inject('Bindings', { ui: { openPage: jest.fn() } })
        Inject('PairingVisitTracker', { openVisit: jest.fn(), closeVisit: jest.fn(), setExitFields: jest.fn(), onBackground: jest.fn(), onForeground: jest.fn() })

        service = create()
        ;(service as any).stateMachine = stateMachine
        ;(service as any).isVisitOpen = false
        ;(service as any).moveTo = jest.fn()
        jest.spyOn(service as any, 'logEvent')
    })

    afterEach( ()=> {
        service.closePage()
        ;(service as any).reset()
        ;['DevicePairing','DeviceConfiguration','AppState','DeviceAccess','Bindings','PairingVisitTracker'].forEach( name=>Inject(name, null))
        jest.useRealTimers()
        jest.clearAllMocks()
    })

    describe('while the trainer is still connecting', ()=> {

        test('opens the helper with "my trainer isn\'t available today" picked, and switches nothing off', async ()=> {
            await open()
            trainerIs('connecting')

            tile('control').onUnselect!()

            expect(pairing.unselectDevices).not.toHaveBeenCalled()
            expect(helper().phase).toBe('open')
            expect(helper().reasons.find( r=>r.selected)?.id).toBe('trainer_unavailable')
            expect(helper().tip?.text).toMatch(/^To ride without your trainer/)
        })

        test('counts as the trainer\'s outcome: it is unavailable now', async ()=> {
            await open()
            trainerIs('connecting')

            tile('control').onUnselect!()

            expect(props()).toMatchObject({ trainerPhase:'unavailable', pairingCase:'trainer-unavailable' })
            expect(logged('pairing trainer phase changed')).toEqual([expect.objectContaining({ fromPhase:'connecting', toPhase:'unavailable', cause:'rider' })])
        })

        test('the helper is logged as opened from the tile switch', async ()=> {
            await open()
            trainerIs('connecting')

            tile('control').onUnselect!()

            expect(logged('pairing helper shown')).toEqual([expect.objectContaining({ trigger:'tile_unselect', trainerPhase:'unavailable' })])
        })
    })

    describe('while the trainer can\'t be reached', ()=> {

        test('opens the helper the same way, and the trainer stays unavailable', async ()=> {
            await open()
            trainerIs('connecting')
            trainerIs('failed')

            tile('control').onUnselect!()

            expect(pairing.unselectDevices).not.toHaveBeenCalled()
            expect(helper()).toMatchObject({ phase:'open' })
            expect(helper().reasons.find( r=>r.selected)?.id).toBe('trainer_unavailable')
            expect(logged('pairing helper shown')).toEqual([expect.objectContaining({ trigger:'tile_unselect' })])
            expect(props().trainerPhase).toBe('unavailable')
        })

        test('with the helper already open by itself, it picks the answer without opening it again', async ()=> {
            await open()
            trainerIs('connecting')
            trainerIs('failed')
            jest.advanceTimersByTime(45_000)  // past the helper threshold on every platform
            expect(helper().phase).toBe('open')
            expect(helper().reasons.some( r=>r.selected)).toBe(false)

            tile('control').onUnselect!()

            expect(logged('pairing helper shown')).toEqual([expect.objectContaining({ trigger:'timer' })])
            expect(helper().reasons.find( r=>r.selected)?.id).toBe('trainer_unavailable')
        })

        test('another tile\'s switch still switches that capability off', async ()=> {
            await open()
            emit([capability('control','trainer-1','connecting'), capability('heartrate','hrm-1','connected','HRM')])
            jest.advanceTimersByTime(TRAINER_ATTEMPT_TIMEOUT_MS.ble)

            tile('heartrate').onUnselect!()

            expect(pairing.unselectDevices).toHaveBeenCalledWith('heartrate')
        })
    })

    describe('the status line\'s "not available today" link', ()=> {

        test('opens the helper with that answer picked', async ()=> {
            await open()
            trainerIs('connecting')
            jest.advanceTimersByTime(TRAINER_ATTEMPT_TIMEOUT_MS.ble)
            helper().onDismiss()
            expect(props().status?.link).toBe('Not available today?')

            helper().onOpen()

            expect(helper().phase).toBe('open')
            expect(helper().reasons.find( r=>r.selected)?.id).toBe('trainer_unavailable')
            expect(logged('pairing helper shown').at(-1)).toMatchObject({ trigger:'trainer_unavailable_link' })
        })

        test('without a trainer that can\'t be reached, the link opens the helper with nothing picked', async ()=> {
            await open()
            emit([])

            helper().onOpen()

            expect(helper().phase).toBe('open')
            expect(helper().reasons.some( r=>r.selected)).toBe(false)
            expect(logged('pairing helper shown').at(-1)).toMatchObject({ trigger:'link' })
        })
    })

    describe('in every other case, the switch switches Resistance off as before', ()=> {

        test('with the trainer connected', async ()=> {
            await open()
            trainerIs('connected', true)

            tile('control').onUnselect!()

            expect(pairing.unselectDevices).toHaveBeenCalledWith('control')
            expect(helper().phase).toBe('hidden')
        })

        test('a power meter in a case without a trainer', async ()=> {
            await open()
            emit([capability('power','pm-1','connected','Stages')], true)

            tile('power').onUnselect!()

            expect(pairing.unselectDevices).toHaveBeenCalledWith('power')
            expect(helper().phase).toBe('hidden')
        })
    })
})
