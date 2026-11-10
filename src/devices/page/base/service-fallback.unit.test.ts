/* eslint-disable @typescript-eslint/no-explicit-any */
import { EventEmitter } from 'node:events'

import { Inject } from '../../../base/decorators/Injection'
import { DesktopPairingPageService } from '../desktop/service'
import { DevicesPageService } from '../mobile/service'

// Riding without the trainer: the page offers the fallback once the trainer can't be reached and a
// separate power meter is connected, shows the fallback state, and lets the rider take the trainer back
// with a tap on its tile. The pairing service and the configuration are fakes that behave like the real
// ones: an exclusion changes the pairing state, and the state is emitted right away.
describe.each([
    ['mobile', ()=>new DevicesPageService(), [{ name:'ble', state:'connected', enabled:true }]],
    ['desktop', ()=>new DesktopPairingPageService(), [{ name:'ant', state:'connected', enabled:true }, { name:'ble', state:'connected', enabled:true }]],
])('%s pairing page - riding without the trainer', (_platform, create, interfaces)=> {

    let service: DevicesPageService|DesktopPairingPageService
    let pairing: any
    let configuration: any
    let tracker: any
    let exclusions: any[]
    let trainerState: string
    let meterState: string

    const stateMachine = {
        state: 'Idle', selectState: 'Inactive',
        start: jest.fn(), stop: jest.fn(), pause: jest.fn().mockResolvedValue(undefined), resume: jest.fn(),
        onDeviceSelectionOpened: jest.fn(), onDeviceSelectionClosed: jest.fn(),
    }

    const excludedFor = (capability:string, udid:string) => {
        const e = exclusions.find( x=>x.capability===capability && x.udid===udid)
        return e ? { reason:e.reason, scope:e.scope } : undefined
    }

    // the trainer in Resistance and Speed, a separate power meter in Power
    const emit = () => {
        const capabilities = [
            { capability:'control', selected:'trainer-1', interface:'ble', disabled:false, devices:[], deviceName:'Tacx Flux', deviceNames:'Tacx Flux', connectState:trainerState, excluded:excludedFor('control','trainer-1') },
            { capability:'power', selected:'pm-1', interface:'ant', disabled:false, devices:[], deviceName:'Stages', deviceNames:'Stages', connectState:meterState },
            { capability:'speed', selected:'trainer-1', interface:'ble', disabled:false, devices:[], deviceName:'Tacx Flux', deviceNames:'Tacx Flux', connectState:trainerState, excluded:excludedFor('speed','trainer-1') },
        ]
        const trainerInUse = !capabilities[0].excluded
        const canStartRide = trainerInUse ? trainerState==='connected' : meterState==='connected'
        const state = { capabilities, interfaces, canStartRide }
        pairing.getState.mockReturnValue(state)
        pairing.emit('pairing-state', state)
    }

    const props = () => service.getPageDisplayProperties()
    const tile = (capability:string) => [...props().capabilities!.top, ...props().capabilities!.bottom].find( t=>t.capability===capability)!
    const helper = () => props().helper!
    const logged = (message:string) => (service as any).logEvent.mock.calls.map( ([e]:any)=>e).filter( (e:any)=>e?.message===message)

    // the trainer's attempt failed while the power meter is connected
    const openUnavailable = async () => {
        service.openPage(false)
        await jest.advanceTimersByTimeAsync(0)
        trainerState = 'connecting'
        emit()
        trainerState = 'failed'
        emit()
        props()
    }

    const chooseFallbackFromHelper = () => {
        helper().onOpen()
        helper().reasons.find( r=>r.id==='trainer_unavailable')!.onSelect()
        helper().action!.onClick()
    }

    beforeEach( ()=> {
        jest.useFakeTimers()
        exclusions = []
        trainerState = 'waiting'
        meterState = 'connected'

        pairing = new EventEmitter() as any
        pairing.getState = jest.fn().mockReturnValue({ capabilities:[], interfaces, canStartRide:false })
        pairing.start = jest.fn().mockResolvedValue(undefined)
        pairing.stop = jest.fn().mockResolvedValue(undefined)
        pairing.prepareStart = jest.fn().mockResolvedValue(undefined)
        pairing.setReadyToStart = jest.fn()
        pairing.setVisitOpen = jest.fn()
        pairing.getSearchStatus = jest.fn().mockReturnValue(undefined)
        pairing.getPendingConflicts = jest.fn().mockReturnValue([])
        pairing.reconnectNow = jest.fn().mockReturnValue(['control','speed'])
        pairing.startDeviceSelection = jest.fn()
        pairing.stopDeviceSelection = jest.fn().mockResolvedValue(undefined)

        configuration = {
            getSimulatorAdapterId: jest.fn().mockReturnValue('sim'),
            excludeDevice: jest.fn( (udid:string, opts:any)=>{
                ['control','speed'].forEach( capability=> exclusions.push({ capability, udid, ...opts, since:Date.now() }))
                emit()
            }),
            includeCapability: jest.fn( (capability:string)=>{
                exclusions = exclusions.filter( e=>e.capability!==capability)
                emit()
            }),
            getExclusions: jest.fn( ()=>[...exclusions]),
        }
        tracker = { openVisit: jest.fn().mockReturnValue({visitId:'visit-1'}), closeVisit: jest.fn(), setExitFields: jest.fn(), onBackground: jest.fn(), onForeground: jest.fn() }

        Inject('DevicePairing', pairing)
        Inject('DeviceConfiguration', configuration)
        Inject('AppState', { setState: jest.fn(), getState: jest.fn(), getPersistedState: jest.fn() })
        Inject('DeviceAccess', { enrichWithAccessState: jest.fn( (i:any)=>i) })
        Inject('Bindings', { ui: { openPage: jest.fn() } })
        Inject('PairingVisitTracker', tracker)

        service = create()
        ;(service as any).stateMachine = stateMachine
        ;(service as any).isVisitOpen = false
        ;(service as any).moveTo = jest.fn()
        jest.spyOn(service as any, 'logEvent')
    })

    afterEach( ()=> {
        service.closePage()
        ;(service as any).reset()
        Inject('DevicePairing', null)
        Inject('DeviceConfiguration', null)
        Inject('AppState', null)
        Inject('DeviceAccess', null)
        Inject('Bindings', null)
        Inject('PairingVisitTracker', null)
        jest.useRealTimers()
        jest.clearAllMocks()
    })

    describe('offering it', ()=> {

        test('"not available today" with a connected power meter offers to ride on it', async ()=> {
            await openUnavailable()
            helper().onOpen()
            helper().reasons.find( r=>r.id==='trainer_unavailable')!.onSelect()

            expect(helper().tip?.text).toMatch(/^You can ride with your power meter instead/)
            expect(helper().action).toEqual({ label:'Ride with power meter only', onClick:expect.any(Function) })
        })

        test('without a separate device, the tip says so and offers the no-device action instead', async ()=> {
            meterState = 'waiting'
            await openUnavailable()
            helper().onOpen()
            helper().reasons.find( r=>r.id==='trainer_unavailable')!.onSelect()

            expect(helper().tip?.text).toBe('To ride without your trainer, Incyclist needs a power meter or speed sensor, and none is connected. Have one? Tap the Power or Speed tile to add it.')
            expect(helper().action).toMatchObject({ label:'Browse routes for now', note:"You'll need one of these devices to start a ride." })
        })
    })

    describe('choosing it', ()=> {

        test('excludes the trainer until the next visit, and the page shows the ride ready without resistance control', async ()=> {
            await openUnavailable()
            chooseFallbackFromHelper()

            expect(configuration.excludeDevice).toHaveBeenCalledWith('trainer-1', { reason:'not-available', scope:'until-next-pairing' })
            expect(props().status).toMatchObject({ id:'S2b', text:'Ready to ride with your power meter, without resistance control, until you next open Devices.' })
            expect(props().capabilities!.rowLabels!.top).toEqual({ text:'✓ READY TO RIDE', subtext:'without resistance control' })
            expect(props().helper!.phase).toBe('hidden')
            expect(props().buttons!.map( b=>b.label)).toEqual(['OK'])
            expect(logged('pairing fallback chosen')).toEqual([expect.objectContaining({ capability:'power' })])
        })

        test('the Resistance tile is dimmed, has no switch, and reads "Tap to use again" in both sizes', async ()=> {
            await openUnavailable()
            chooseFallbackFromHelper()

            expect(tile('control')).toMatchObject({ dimmed:true, roleLabel:'Your trainer', footerText:{ full:'Tap to use again', short:'Tap to use again' }, awaited:false })
            expect(tile('control').onUnselect).toBeUndefined()
            expect(tile('speed')).toMatchObject({ dimmed:true, footerText:{ full:'Not used', short:'Not used' } })
            expect(tile('speed').onUnselect).toBeUndefined()
            expect(tile('power').dimmed).toBeUndefined()
        })
    })

    describe('taking the trainer back with a tap on its tile', ()=> {

        test('takes the trainer back first, then asks for a connection attempt right away', async ()=> {
            await openUnavailable()
            chooseFallbackFromHelper()

            tile('control').onClick(tile('control'))

            expect(exclusions).toEqual([])
            expect(pairing.reconnectNow).toHaveBeenCalledTimes(1)
            expect(configuration.includeCapability.mock.invocationCallOrder.at(-1)).toBeLessThan(pairing.reconnectNow.mock.invocationCallOrder[0])
        })

        test('the page goes straight to trying to reach the trainer, not back to plain "can\'t reach"', async ()=> {
            await openUnavailable()
            chooseFallbackFromHelper()
            const seen:string[] = []
            ;(service as any).getPageObserver().on('page-update', ()=>{ seen.push(props().status!.id) })

            tile('control').onClick(tile('control'))

            expect(props().status).toMatchObject({ id:'S7a', text:'Trying to reach your trainer Tacx Flux…', link:'Not available today?' })
            expect(seen).not.toContain('S7')
            expect(tile('control')).toMatchObject({ footerText:{ full:'Connecting…', short:'Connecting…' }, awaited:true })
            expect(tile('control').dimmed).toBeUndefined()
            expect(props().capabilities!.rowLabels!.top).toEqual({ text:'TO RIDE', subtext:'waiting for your trainer' })
        })

        test('is logged once as the rider\'s attempt from the tile, and once as cancelling the fallback', async ()=> {
            await openUnavailable()
            chooseFallbackFromHelper()

            tile('control').onClick(tile('control'))

            const retries = logged('pairing trainer retry')
            expect(retries).toHaveLength(1)
            expect(retries[0]).toMatchObject({ trigger:'tile', retryIndex:1, retryCapabilities:'control,speed', pairingCase:'trainer-unavailable', separateDeviceConnected:true })
            expect(logged('pairing fallback cancelled')).toHaveLength(1)
            expect(logged('pairing fallback reverted')).toHaveLength(0)
        })

        test('the attempt ends when the trainer connects: the ride is ready on the trainer', async ()=> {
            await openUnavailable()
            chooseFallbackFromHelper()
            tile('control').onClick(tile('control'))

            trainerState = 'connected'
            emit()

            expect(props().status!.id).toBe('S2')
            expect(logged('pairing trainer retry ended')).toEqual([expect.objectContaining({ retryResult:'connected' })])
        })

        test('the attempt failing says the trainer still can\'t be reached', async ()=> {
            await openUnavailable()
            chooseFallbackFromHelper()
            tile('control').onClick(tile('control'))

            trainerState = 'connecting'
            emit()
            trainerState = 'failed'
            emit()

            expect(props().status!.id).toBe('S7b')
        })

        test('an ordinary Resistance tile tap still opens the device list', async ()=> {
            await openUnavailable()
            const openDeviceSelection = jest.spyOn(service as any, 'openDeviceSelection')

            tile('control').onClick(tile('control'))

            expect(openDeviceSelection).toHaveBeenCalledWith('control')
            expect(pairing.reconnectNow).not.toHaveBeenCalled()
        })
    })

    describe('the trainer connecting while the fallback is active', ()=> {

        test('says resistance control is back on, then the usual ready status', async ()=> {
            await openUnavailable()
            chooseFallbackFromHelper()

            trainerState = 'connected'
            exclusions = []
            emit()
            pairing.emit('exclusion-reverted', { udid:'trainer-1', capabilities:['control','speed'] })

            expect(props().status).toMatchObject({ id:'S2c', text:'Your trainer connected. Resistance control is back on.' })
            jest.advanceTimersByTime(3000)
            expect(props().status!.id).toBe('S2')
            expect(logged('pairing fallback cancelled')).toHaveLength(0)
        })
    })

    describe('buttons', ()=> {

        // every state the rider can get to here, from the first search to the trainer's attempts
        // after taking it back; the rider's own attempt is started from the tile, never from a button
        it.each([false, true])('never include a "Try again" button (opened for a ride: %s)', async (forRide)=> {
            const labels = new Set<string>()
            const collect = () => { props().buttons!.forEach( b=>labels.add(b.label)) }
            const searchStates = [
                { running:true, ended:false, canStop:false, canSearchAgain:false, rideCapableFound:false, trainerFound:false, missing:['control'] },
                { running:true, ended:false, canStop:true, canSearchAgain:false, rideCapableFound:true, trainerFound:false, missing:['control'] },
                { running:false, ended:true, canStop:false, canSearchAgain:true, rideCapableFound:false, trainerFound:false, missing:['control'] },
                { running:false, ended:true, canStop:false, canSearchAgain:true, rideCapableFound:true, trainerFound:false, missing:['control'] },
            ]

            service.openPage(forRide)
            await jest.advanceTimersByTimeAsync(0)
            for (const search of searchStates) {
                pairing.getSearchStatus.mockReturnValue(search)
                collect()
            }
            pairing.getSearchStatus.mockReturnValue(undefined)

            for (const state of ['connecting','failed','waiting']) {   // connecting, can't reach it, retries
                trainerState = state
                emit()
                collect()
            }
            meterState = 'waiting'
            emit()
            collect()
            meterState = 'connected'
            emit()

            chooseFallbackFromHelper()                                    // riding on the power meter
            collect()
            tile('control').onClick(tile('control'))                       // trying to reach it again
            collect()
            jest.advanceTimersByTime(60_000)                               // that attempt failed
            collect()
            trainerState = 'connected'                                     // and the trainer finally connects
            emit()
            collect()

            // the states above really were reached
            expect([...labels]).toEqual(expect.arrayContaining(['Stop searching', 'Search again', forRide ? 'Start' : 'OK', forRide ? 'Cancel' : 'Skip']))
            expect([...labels]).not.toContain('Try again')
            expect([...labels].filter( l=>/try/i.test(l))).toEqual([])
        })
    })

    describe('the page leaving', ()=> {

        test('says whether the fallback was active, and how often the rider tried again', async ()=> {
            let fieldsAtClose:any
            tracker.closeVisit.mockImplementation( ()=>{ fieldsAtClose = tracker.setExitFields.mock.calls[0][0]() })
            await openUnavailable()
            chooseFallbackFromHelper()
            ;(service as any).onOK()

            expect(fieldsAtClose).toMatchObject({ fallbackActive:true, trainerRetries:0 })
        })
    })
})
