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