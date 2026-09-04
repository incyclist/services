import { beforeEach } from 'node:test'
import { Inject } from '../../base/decorators'
import { Observer } from '../../base/types'
import { ActivityRideService } from '../ride'
import { ActiveRideListMessageQueue } from './mq'
import {ActiveRidesService, useActiveRides} from './service'
describe('ActiveRides',()=>{

    const MockObserver: Partial<Observer> = {
        
        on: jest.fn(),
        off: jest.fn(),
        once: jest.fn()
    }

    const MockRide:Partial<ActivityRideService> = {
        getObserver: jest.fn().mockReturnValue(MockObserver),
    }

    const MockMessageQueue: Partial<ActiveRideListMessageQueue> = {
        subscribe: jest.fn(),
        unsubscribe: jest.fn(),
        onConnect: jest.fn(),
        onDisconnect: jest.fn(),
        sendMessage: jest.fn(),
        unsubscribeAll: jest.fn()
    }

    let service: ActiveRidesService

    const setupMocks =(s:any,props?) => {
        Inject('ActivityRide',props?.activityRide??MockRide)
        s.getMessageQueue = jest.fn().mockReturnValue(props?.messageQueue??MockMessageQueue)

    }

    const cleanupMocks = (s)=>{
        s.reset()
        jest.clearAllMocks()
    }



    afterEach( ()=>{
        cleanupMocks(service)
    })

    test('init',()=>{
        service = useActiveRides()
        setupMocks(service)

        const observer = service.init('123')
        expect(observer).toBeDefined()

    })

    test('online status handler stays bound to the service instance', ()=>{
        // Regression test: startOnlineCheck() used to register the unbound
        // this.onOnlineStatusChange as the 'onlineStatus' listener instead of the
        // pre-bound this.onlineStatusHandler. EventEmitter invokes listeners without
        // preserving the original `this`, so on a later transition `this` resolved to
        // the emitter instead of the service, and this.onDisconnect()/this.onConnect()
        // - and then this.logError() in the catch block - were "not a function",
        // crashing the app uncaught.
        service = useActiveRides()
        setupMocks(service)

        const monitoring = (service as any).getOnlineStatusMonitoring()
        const startSpy = jest.spyOn(monitoring,'start')

        service.init('123')

        const [,registeredHandler] = (startSpy.mock.calls.find( ([context])=>context==='activeRides') ?? []) as [string, (online:boolean)=>void]
        expect(registeredHandler).toBeDefined()

        // simulate how the EventEmitter actually invokes listeners: with a receiver
        // that is not the service instance
        const foreignReceiver = {}
        expect( ()=>registeredHandler.call(foreignReceiver,true)).not.toThrow()
        expect( ()=>registeredHandler.call(foreignReceiver,false)).not.toThrow()

        monitoring.stop('activeRides')
    })

    test('getDisplayProps - coach entry surfaces isCoach:true, regular rider stays isCoach:false',()=>{
        service = useActiveRides()
        setupMocks(service)

        const s:any = service
        s.session = 'S1'
        s.current = {
            id: 'current',
            user: { id: 'u1', name: 'Me' },
            ride: { isLap: false, distance: 10000 },
            sessionId: 'S1',
            currentRideDistance: 1000,
        }
        s.getCoachesService = jest.fn().mockReturnValue({
            getCoaches: jest.fn().mockReturnValue([
                {
                    getRidersListDisplayProperties: () => ({
                        user: { id: 'coach1', name: 'Coach Bot' },
                        isCoach: true,
                        currentPower: 150,
                        currentRideDistance: 500,
                    })
                }
            ])
        })

        const displayProps = s.getDisplayProps()

        const userRow = displayProps.find((r:any) => r.name === 'Me')
        const coachRow = displayProps.find((r:any) => r.name === 'Coach Bot')

        expect(coachRow).toBeDefined()
        expect(coachRow.isCoach).toBe(true)
        expect(userRow).toBeDefined()
        expect(userRow.isCoach).toBeFalsy()
    })

    describe('getDisplayProps - sort order', () => {

        // diffDistance is {value,unit} - comparing the objects directly with `>` always evaluates
        // false either way (both coerce to "[object Object]"), silently no-op'ing the sort and
        // leaving get()'s insertion order ([current, ...others, ...coaches], self always first)
        // untouched regardless of actual position. Found via real multi-device testing: both
        // devices showed "self first" instead of a consistent leaderboard order.

        test('ascending by diffDistance, not insertion order - viewer behind the other rider', () => {
            service = useActiveRides()
            setupMocks(service)

            const s: any = service
            s.session = 'MOBILE'
            s.current = {
                id: 'current', user: { id: 'mobile-user', name: 'MobileMe' },
                ride: { isLap: false, distance: 40000 }, sessionId: 'MOBILE',
                currentRideDistance: 11000,
            }
            s.others = [{
                id: 'other1', sessionId: 'DESKTOP', user: { id: 'desktop-user', name: 'DesktopThem' },
                currentRideDistance: 11500, // 500m ahead of "me"
            }]

            const displayProps = s.getDisplayProps()

            // ahead-of-me rider (negative diffDistance) sorts before me, not after - self is not
            // pinned first just because get() built the array that way
            expect(displayProps.map((r: any) => r.name)).toEqual(['DesktopThem', 'MobileMe'])
        })

        test('ascending by diffDistance - viewer ahead of the other rider', () => {
            service = useActiveRides()
            setupMocks(service)

            const s: any = service
            s.session = 'DESKTOP'
            s.current = {
                id: 'current', user: { id: 'desktop-user', name: 'DesktopMe' },
                ride: { isLap: false, distance: 40000 }, sessionId: 'DESKTOP',
                currentRideDistance: 11500,
            }
            s.others = [{
                id: 'other1', sessionId: 'MOBILE', user: { id: 'mobile-user', name: 'MobileThem' },
                currentRideDistance: 11000, // 500m behind "me"
            }]

            const displayProps = s.getDisplayProps()

            expect(displayProps.map((r: any) => r.name)).toEqual(['DesktopMe', 'MobileThem'])
        })

        test('closest-N trim (maxLength) also compares by value, not the {value,unit} object', () => {
            service = useActiveRides()
            setupMocks(service)

            const s: any = service
            s.session = 'ME'
            s.maxLength = 2
            s.current = {
                id: 'current', user: { id: 'me', name: 'Me' },
                ride: { isLap: false, distance: 40000 }, sessionId: 'ME',
                currentRideDistance: 10000,
            }
            s.others = [
                { id: 'far-ahead', sessionId: 'A', user: { id: 'a', name: 'FarAhead' }, currentRideDistance: 15000 },
                { id: 'close-behind', sessionId: 'B', user: { id: 'b', name: 'CloseBehind' }, currentRideDistance: 9800 },
                { id: 'far-behind', sessionId: 'C', user: { id: 'c', name: 'FarBehind' }, currentRideDistance: 5000 },
            ]

            const displayProps = s.getDisplayProps()

            // trimmed to the 2 closest by absolute gap: Me (0) and CloseBehind (-200m) - the two
            // far entries must not survive just because Math.abs() on the {value,unit} object was
            // silently NaN for everyone
            expect(displayProps.map((r: any) => r.name).sort()).toEqual(['CloseBehind', 'Me'].sort())
        })
    })

    describe('MQTT activity event handlers emit update', () => {

        let observerEmit: jest.Mock

        const setupService = (s:any) => {
            s.session = 'MYSESSION'
            observerEmit = jest.fn()
            s.observer = { emit: observerEmit, stop: jest.fn() }
            s.getDisplayProps = jest.fn().mockReturnValue([{ name: 'stub' }])
            s.getActivityRide = jest.fn().mockReturnValue({
                getActivity: jest.fn().mockReturnValue({ id:'a1', route:{title:'Route'} }),
                getObserver: jest.fn().mockReturnValue(MockObserver)
            })
        }

        test('onActivityUpdateEvent - known rider: mutates state and emits update with fresh display data', async () => {
            service = useActiveRides()
            setupMocks(service)
            const s:any = service
            setupService(s)

            const existing:any = { sessionId:'OTHER', user:{id:'u2',name:'Jane'} }
            s.others = [existing]

            const payload = {
                position:{lat:1,lng:2,elevation:3,slope:4},
                rideDistance: 500,
                speed: 30, power: 200, cadence: 90, heartrate: 140, lap: 1, duration: 60
            }

            await s.onActivityUpdateEvent('OTHER', payload)

            // internal state was mutated
            expect(existing.currentPosition).toEqual(payload.position)
            expect(existing.currentPower).toBe(200)
            expect(existing.currentRideDistance).toBe(500)
            expect(existing.currentSpeed).toBe(30)
            expect(existing.currentLap).toBe(1)

            // observer was notified
            expect(observerEmit).toHaveBeenCalledWith('update', s.getDisplayProps())
        })

        test('onActivityUpdateEvent - new rider joins (no existing entry, no remote details): adds rider and emits update', async () => {
            service = useActiveRides()
            setupMocks(service)
            const s:any = service
            setupService(s)

            s.others = []
            s.getRemoteActivityDetails = jest.fn().mockResolvedValue(undefined)

            const payload = {
                position:{lat:1,lng:2,elevation:3,slope:4},
                rideDistance: 100,
                speed: 20, power: 150, cadence: 80, heartrate: 120, lap: 1, duration: 30
            }

            await s.onActivityUpdateEvent('NEWSESSION', payload)

            expect(s.others.some((o:any)=>o.sessionId==='NEWSESSION')).toBe(true)
            expect(observerEmit).toHaveBeenCalledWith('update', s.getDisplayProps())
        })

        test('onActivityStartEvent - new rider joins: adds rider and emits update', () => {
            service = useActiveRides()
            setupMocks(service)
            const s:any = service
            setupService(s)

            s.current = { user:{id:'u1',name:'Me'}, sessionId:'MYSESSION' }
            s.others = []
            s.getRemoteActivityDetails = jest.fn()

            const payload = {
                user:{id:'u2',name:'Jane'},
                ride:{ isLap:false, distance:10000 }
            }

            s.onActivityStartEvent('OTHER', payload)

            expect(s.others.some((o:any)=>o.sessionId==='OTHER')).toBe(true)
            expect(observerEmit).toHaveBeenCalledWith('update', s.getDisplayProps())
        })

        test('onActivityStopEvent - known rider leaves: removes rider and emits update', () => {
            service = useActiveRides()
            setupMocks(service)
            const s:any = service
            setupService(s)

            s.current = { user:{id:'u1',name:'Me'}, sessionId:'MYSESSION' }
            s.others = [{ sessionId:'OTHER', user:{id:'u2',name:'Jane'} }]
            s.isStarted = true

            s.onActivityStopEvent('OTHER', {})

            expect(s.others.some((o:any)=>o.sessionId==='OTHER')).toBe(false)
            expect(observerEmit).toHaveBeenCalledWith('update', s.getDisplayProps())
        })

        test('onActivityStopEvent - unknown session: no state change, no emit', () => {
            service = useActiveRides()
            setupMocks(service)
            const s:any = service
            setupService(s)

            s.current = { user:{id:'u1',name:'Me'}, sessionId:'MYSESSION' }
            s.others = [{ sessionId:'OTHER', user:{id:'u2',name:'Jane'} }]
            s.isStarted = true

            s.onActivityStopEvent('UNKNOWN', {})

            expect(s.others.length).toBe(1)
            expect(observerEmit).not.toHaveBeenCalled()
        })
    })

    test('getName',()=>{
        service = useActiveRides()
        setupMocks(service)

        const run = (s:any, userName?:string)=>{
            s.current = { user:{id:'9999',name:'Current User'} }
            s.randomName = jest.fn().mockReturnValue('Random')

            return s.getName({user:{id:'1234',name:userName},sessionId:'abcd'})

        }

        expect(run(service,'John')).toBe('John')
        expect(run(service,undefined)).toBe('Random')
        expect(run(service,'')).toBe('Random')
        expect(run(service,'undefined')).toBe('Random')
        expect(run(service,'undefined undefined')).toBe('Random')
    })

        
})