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

    const setupMocks =(s,props?) => {
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
})