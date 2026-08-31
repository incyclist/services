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