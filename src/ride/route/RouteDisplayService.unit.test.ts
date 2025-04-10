
import sydney from '../../../__tests__/data/routes/sydney2.json'
import { Inject } from '../../base/decorators'
import { createFromJson } from '../../routes'
import { RouteApiDetail } from '../../routes/base/api/types'
import { RouteSettings } from '../../routes/list/cards/RouteCard'
import { RouteDisplayService } from './RouteDisplayService'
import { CurrentRideService} from '../current/service'
import { Observer } from '../../base/types'

const OC = expect.objectContaining
const CT = expect.closeTo

describe( 'RouteDisplayService', () => {

    const sydneyRoute  = createFromJson(sydney as unknown as RouteApiDetail)
    sydneyRoute.description.distance = 3801.452188724582
    sydneyRoute.description.isLoop   = true

    const defaultStartSettings:RouteSettings = {
        startPos:0,
        realityFactor:100,
        type:'Route'
    }

    const mockObserver: Partial<Observer> = {
        on: jest.fn(),
        off: jest.fn(),
        once: jest.fn(),
        emit: jest.fn()
    }

    let mockRideService 
    

    const setupMocks = (s, options) => {  
        Inject('UserSettings',{
            get:jest.fn( (k,d)=> d)
        })
        Inject('RouteList',{
            getSelected: jest.fn().mockReturnValue(options.route??sydneyRoute),
            getStartSettings: jest.fn().mockReturnValue(options.startSettings??defaultStartSettings)
        })

        mockRideService = new CurrentRideService()
        mockRideService.getObserver= jest.fn().mockReturnValue(mockObserver)
        mockRideService.displayService = s
                    
        if (options.mockRideService) {
            s.observer = mockObserver
            s.service = mockRideService
            s.init(mockRideService)
        }
        s.emit= jest.fn()
    }

    const getPosition = (s) => {
        return s.position
    }

    const cleanupMocks = (s)=>{
        s.reset()
        if (mockRideService)
            mockRideService.reset()
        jest.clearAllMocks()
    }

    describe('onDeviceData',()=>{
        let service: RouteDisplayService


        beforeEach( async ()=>{
            service = new RouteDisplayService()
            
        })
    
        afterEach( async ()=>{
            cleanupMocks(service)
        })

        test('at start of route',async ()=>{
            const startSettings = { ...defaultStartSettings}
            setupMocks(service,{mockRideService:true,startSettings})
            service.onDeviceData({distance:10}, '1234')
            expect(mockObserver.emit).toHaveBeenCalledWith('position-update',OC({position:OC({lap:1,routeDistance:10})}))
            

        })
        test('with startPos set',async ()=>{
            const startSettings = { ...defaultStartSettings, startPos: 1826}
            setupMocks(service,{mockRideService:true,startSettings})

            service.onDeviceData({distance:10}, '1234')

        })

        test('reaching end of lap',async ()=>{
            const startSettings = { ...defaultStartSettings, startPos: 3800}
            setupMocks(service,{mockRideService:true,startSettings})

            service.onDeviceData({distance:10}, '1234')
            expect(mockObserver.emit).toHaveBeenCalledWith('position-update',OC({position:OC({lap:2,routeDistance:3810, lapDistance:CT(8.5,1)})}))
            expect(service.emit).toHaveBeenCalledWith('lap-completed',1,2)
        })

        test('user wants to stop at end - reaching end of lap',async ()=>{
            const startSettings = { ...defaultStartSettings, startPos: 3800, loopOverwrite: true}
            setupMocks(service,{mockRideService:true,startSettings})

            service.onDeviceData({distance:10}, '1234')
            expect(service.emit).toHaveBeenCalledWith('route-completed')
        })

        test('multiple updates',async ()=>{
            const startSettings = { ...defaultStartSettings}
            setupMocks(service,{mockRideService:true,startSettings})
            for (let i=0; i<10; i++) {
                service.onDeviceData({distance:10}, '1234')
            }
            expect(mockObserver.emit).toHaveBeenCalledTimes(10)
            expect(getPosition(service)).toMatchObject({lap:1,routeDistance:CT(100,1)})
            

        })

        test('strange values',async ()=>{
            const startSettings = { ...defaultStartSettings, startPos: 3785, loopOverwrite: true}
            setupMocks(service,{mockRideService:true,startSettings})
            
            service['position'] = {
                
                "lat": -33.85925,
                "lng": 151.22181,
                "elevation": 0.4841195529418787,
                "distance": 17.962621015984496,
                "slope": -6.352085248824286,
                "routeDistance": 3790,
                "cnt": 192,
                "lap": 1,
                "lapDistance": 3790
            }
            service.onDeviceData({distance:6}, '1234')

            
            expect(getPosition(service)).toMatchObject({lap:1,routeDistance:CT(3796,0)})
            

        })
    

    })






}) 