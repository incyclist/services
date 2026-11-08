/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'node:events'

import { Inject } from '../../../base/decorators/Injection'
import { DesktopPairingPageService } from '../desktop/service'
import { DevicesPageService } from '../mobile/service'
import { TRAINER_ATTEMPT_TIMEOUT_MS } from './guidance'
import type { CapabilityDisplayProps } from './types'

describe.each([
    ['mobile', ()=>new DevicesPageService(), [{ name:'ble', state:'connected', enabled:true }, { name:'wifi', state:'connected', enabled:true }]],
    ['desktop', ()=>new DesktopPairingPageService(), [{ name:'ant', state:'connected', enabled:true }, { name:'ble', state:'connected', enabled:true }]],
])('%s pairing page - tiles and the configured trainer', (_platform, create, interfacesUp)=> {

    let service: DevicesPageService|DesktopPairingPageService
    let pairing: any
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

    const trainer = (capability:string, connectState='connecting') => ({ capability, selected:'trainer-1', interface:'ble', disabled:false, devices:[], deviceName:'Tacx Flux', deviceNames:'Tacx Flux', connectState })
    const powerMeter = (connectState:string) => ({ capability:'power', selected:'pm-1', interface:'ant', disabled:false, devices:[], deviceName:'Stages', deviceNames:'Stages', connectState })
    const empty = (capability:string) => ({ capability, disabled:false, devices:[] })
    const switchedOff = (capability:string, deviceName?:string) => ({ capability, selected: deviceName ? 'trainer-1' : undefined, disabled:true, devices:[], deviceName, deviceNames:deviceName })

    const emit = (capabilities:any[], canStartRide=false) => {
        const state = { capabilities, interfaces, canStartRide }
        pairing.getState.mockReturnValue(state)
        pairing.emit('pairing-state', state)
    }
    const props = () => service.getPageDisplayProperties()
    const tiles = (): CapabilityDisplayProps[] => {
        const caps = props().capabilities!
        return [...caps.top, ...caps.bottom]
    }
    const tileOf = (capability:string) => tiles().find( t=>t.capability===capability)!
    const pickReason = (id:string) => props().helper!.reasons.find( r=>r.id===id)!.onSelect()

    const openReady = async () => {
        service.openPage(false)
        await jest.advanceTimersByTimeAsync(0)
    }

    const makeUnavailable = (capabilities:any[]) => {
        emit(capabilities)
        jest.advanceTimersByTime(TRAINER_ATTEMPT_TIMEOUT_MS.ble)
        emit(capabilities.map( c=>c.selected==='trainer-1' && !c.disabled ? {...c, connectState:'waiting'} : c))
    }

    // the trainer on Resistance, Power and Cadence; Speed and Heartrate empty
    const trainerOnSeveralTiles = ():any[] => [trainer('control'), trainer('power'), empty('speed'), trainer('cadence'), empty('heartrate')]

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

        Inject('DevicePairing', pairing)
        Inject('AppState', { setState: jest.fn(), getState: jest.fn(), getPersistedState: jest.fn() })
        Inject('DeviceConfiguration', { getSimulatorAdapterId: jest.fn().mockReturnValue('sim') })
        Inject('DeviceAccess', { enrichWithAccessState: jest.fn( (i:any)=>i) })
        Inject('Bindings', { ui: { openPage: jest.fn() } })
        Inject('PairingVisitTracker', { openVisit: jest.fn().mockReturnValue({visitId:'visit-1'}), closeVisit: jest.fn(), setExitFields: jest.fn(), onBackground: jest.fn(), onForeground: jest.fn() })

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

        test('the Resistance tile is waited for, as the rider\'s trainer', async ()=> {
            await openReady()
            makeUnavailable(trainerOnSeveralTiles())

            expect(tileOf('control')).toMatchObject({
                trainerRole:'trainer', roleLabel:'Your trainer', deviceName:'Tacx Flux',
                footerText:{ full:'Not connected · waiting', short:'Waiting…' }, awaited:true,
            })
        })

        test('the other tiles holding the trainer wait for it, without an outline', async ()=> {
            await openReady()
            makeUnavailable(trainerOnSeveralTiles())

            for (const capability of ['power','cadence'])
                expect(tileOf(capability)).toMatchObject({
                    trainerRole:'via-trainer', roleLabel:'via your trainer',
                    footerText:{ full:'Waiting for trainer', short:'Via trainer' }, awaited:false,
                })
        })

        test('an empty speed tile is optional for now, an empty heart-rate tile is unchanged', async ()=> {
            await openReady()
            makeUnavailable(trainerOnSeveralTiles())

            expect(tileOf('speed')).toMatchObject({ footerText:{ full:'Optional for now', short:'Optional for now' }, awaited:false })
            expect(tileOf('speed').trainerRole).toBeUndefined()
            expect(tileOf('heartrate')).toMatchObject({ emptyFooter:'Optional', awaited:false })
            expect(tileOf('heartrate').footerText).toBeUndefined()
        })

        test('a separate connected power meter can replace the trainer', async ()=> {
            await openReady()
            makeUnavailable([trainer('control'), powerMeter('connected'), empty('speed')])

            expect(tileOf('power')).toMatchObject({
                trainerRole:'separate', deviceName:'Stages', connectState:'connected',
                footerText:{ full:'CONNECTED · can replace trainer', short:'Can replace trainer' }, awaited:false,
            })
            expect(tileOf('power').roleLabel).toBeUndefined()
        })

        test('a separate power meter that is still connecting keeps its usual state', async ()=> {
            await openReady()
            makeUnavailable([trainer('control'), powerMeter('connecting'), empty('speed')])

            const power = tileOf('power')
            expect(power).toMatchObject({ connectState:'connecting', awaited:false })
            expect(power.trainerRole).toBeUndefined()
            expect(power.footerText).toBeUndefined()
        })

        test('once the rider says the trainer is not available today, power and speed are waited for', async ()=> {
            await openReady()
            makeUnavailable(trainerOnSeveralTiles())
            props().helper!.onOpen()
            pickReason('trainer_unavailable')

            expect(tileOf('power')).toMatchObject({
                trainerRole:'via-trainer', roleLabel:'via your trainer', footerText:{ full:'Tap to add', short:'Tap to add' }, awaited:true,
            })
            expect(tileOf('speed')).toMatchObject({ footerText:{ full:'Tap to add', short:'Tap to add' }, awaited:true })
            expect(tileOf('cadence')).toMatchObject({ footerText:{ full:'Waiting for trainer', short:'Via trainer' }, awaited:false })
            expect(tileOf('control')).toMatchObject({ trainerRole:'trainer', awaited:true })
        })

        test('with a separate power meter connected, the speed tile stays optional after "not available today"', async ()=> {
            await openReady()
            makeUnavailable([trainer('control'), powerMeter('connected'), empty('speed')])
            props().helper!.onOpen()
            pickReason('trainer_unavailable')

            expect(tileOf('speed')).toMatchObject({ footerText:{ full:'Optional for now', short:'Optional for now' }, awaited:false })
            expect(tileOf('power')).toMatchObject({ trainerRole:'separate', awaited:false })
        })

        test('the trainer connecting ends it', async ()=> {
            await openReady()
            makeUnavailable(trainerOnSeveralTiles())
            emit(trainerOnSeveralTiles().map( c=>c.selected ? {...c, connectState:'connected'} : c), true)

            for (const t of tiles()) {
                expect(t.trainerRole).toBeUndefined()
                expect(t.roleLabel).toBeUndefined()
                expect(t.footerText).toBeUndefined()
                expect(t.awaited).toBe(false)
            }
        })
    })

    describe('precedence', ()=> {

        test('a switched-off tile keeps its switched-off state while the trainer cannot be reached', async ()=> {
            await openReady()
            makeUnavailable([trainer('control'), switchedOff('power','Tacx Flux'), switchedOff('speed')])
            props().helper!.onOpen()
            pickReason('trainer_unavailable')

            expect(tileOf('power')).toMatchObject({ disabled:true, deviceName:'Tacx Flux', emptyFooter:'Not used', awaited:false })
            expect(tileOf('speed')).toMatchObject({ disabled:true, emptyFooter:'Not used · tap to search', awaited:false })
            for (const capability of ['power','speed']) {
                expect(tileOf(capability).trainerRole).toBeUndefined()
                expect(tileOf(capability).roleLabel).toBeUndefined()
                expect(tileOf(capability).footerText).toBeUndefined()
            }
        })

        test('while nothing can search, no tile has a trainer state or an outline', async ()=> {
            await openReady()
            makeUnavailable(trainerOnSeveralTiles())
            for (const i of interfaces)
                i.enabled = false
            emit(trainerOnSeveralTiles().map( c=>c.selected ? {...c, connectState:'waiting'} : c))

            expect(props().status?.id).toBe('S1')
            expect(tileOf('speed').emptyFooter).toBe('Not searching')
            for (const t of tiles()) {
                expect(t.trainerRole).toBeUndefined()
                expect(t.roleLabel).toBeUndefined()
                expect(t.footerText).toBeUndefined()
                expect(t.awaited).toBe(false)
            }
        })
    })

    describe('outside the trainer\'s unavailable state', ()=> {

        test('while the trainer connects, the Resistance tile and empty required tiles are waited for, tiles holding it are plain', async ()=> {
            await openReady()
            emit(trainerOnSeveralTiles())

            expect(tileOf('control').awaited).toBe(true)
            expect(tileOf('speed')).toMatchObject({ emptyFooter:'Searching…', awaited:true })
            expect(tileOf('power').awaited).toBe(false)
            expect(tileOf('heartrate').awaited).toBe(false)
            for (const t of tiles()) {
                expect(t.trainerRole).toBeUndefined()
                expect(t.footerText).toBeUndefined()
            }
        })

        test('without a trainer, empty required tiles are waited for until the row is ready', async ()=> {
            await openReady()
            emit([empty('control'), powerMeter('connecting'), empty('speed'), empty('heartrate')])

            expect(tileOf('control').awaited).toBe(true)
            expect(tileOf('speed').awaited).toBe(true)
            expect(tileOf('power').awaited).toBe(false)
            expect(tileOf('heartrate').awaited).toBe(false)

            emit([empty('control'), powerMeter('connected'), empty('speed'), empty('heartrate')], true)
            expect(tiles().map( t=>t.awaited)).not.toContain(true)
        })
    })
})
