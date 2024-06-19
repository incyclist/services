import { ActivityRideService } from "./service"
import sydney from '../../../__tests__/data/routes/sydney.json'
import sydney1 from '../../../__tests__/data/routes/sydney1.json'
import { createFromJson} from "../../routes/base/utils/route"
import { RouteApiDetail } from "../../routes/base/api/types"
import { EventEmitter } from "stream"
import { waitNextTick } from "../../utils"


import troll from '../../../__tests__/data/activities/troll-90.json'
import { ActivityDetails, buildSummary } from '../base'


describe('ActivityRideService',()=>{

    const mockUserSettingsGet = (key,defValue) => {
        const json = {
            uuid: 'test',
            user: {
                weight: 75,
                ftp:200
            }
        }
        return json[key]??defValue        
    }

    const resetSingleton = (service) =>{
        service.reset()
    }

    const mockServices = (svc,props?) => {
        svc.getUserSettings = jest.fn( ()=> ({
            get:jest.fn( mockUserSettingsGet)
        }))
        svc.getRouteList = jest.fn( ()=> ({
            getSelected: jest.fn().mockReturnValue(props?.route),
            getStartSettings: jest.fn().mockReturnValue(props?.startSettings)
        }))
        svc.getRepo = jest.fn( ()=> ({
            getFilename: jest.fn(name=> props?.filename??`/tmp/${name}.json`),
            save: jest.fn( async () => {return})
        }))
        svc.getDeviceRide = jest.fn( ()=>{
            const emitter = props?.ride??new EventEmitter()

            return {
                on: jest.fn(emitter.on.bind(emitter)),
                off: jest.fn(emitter.off.bind(emitter))
            }
        })

    
    }
    describe ('init',()=>{
        let service:ActivityRideService
        beforeEach( ()=>{
            service = new ActivityRideService()
            jest .useFakeTimers().setSystemTime(new Date('2020-01-01'));
        })

        afterEach( ()=>{
            service.stop()
            resetSingleton(service)
            jest.useRealTimers()
        })


        test('XML from start of route',()=>{
            const route  = createFromJson(sydney as unknown as RouteApiDetail)
            mockServices(service,{route,startSettings:{startPos:0,realityFactor:100,type:'Route'}})
            const observer = service.init()
            expect(observer).toBeDefined()
            expect(service.getActivity()).toMatchObject({
                type:'IncyclistActivity',
                version: '1',
                id: expect.anything(),
                distance:0,time:0, totalElevation:0,
                startPos: 0,
                realityFactor:100,
                name: 'Incyclist Ride-20200101010000',
                routeType: 'GPX',
                route: expect.objectContaining({
                    name:'Sydney Opera House and Botanic Garden'
                }),
                logs:[]
            })
            

        })
        test('XML from different start position/realityFactor',()=>{
            const route  = createFromJson(sydney as unknown as RouteApiDetail)
            
            mockServices(service,{route,startSettings:{startPos:1000,realityFactor:50,type:'Route'}})
            const observer = service.init()
            expect(observer).toBeDefined()
            expect(service.getActivity()).toMatchObject({
                distance:0,time:0, totalElevation:0,
                startPos: 1000,
                realityFactor:50,
                logs:[]
            })

        })

        test('Free Ride',()=>{
            const path =[
                    {lat: 40.28908245275464, lng: 23.389428365252346,elevation: 0.1061634434781438,routeDistance:0},
                    {lat: 40.289108886192935, lng: 23.389433183088087,elevation: 0.18467297903991475,routeDistance:3 }
                    ]               

            mockServices(service,{startSettings:{startPos:0,realityFactor:100,type:'Free-Ride',option:{path}}})
            const observer = service.init()
            expect(observer).toBeDefined()
            expect(service.getActivity()).toMatchObject({
                type:'IncyclistActivity',
                version: '1',
                id: expect.anything(),
                distance:0,time:0, totalElevation:0,
                startPos: 0,
                realityFactor:0,
                name: 'Incyclist Ride-20200101010000',
                routeType: 'Free-Ride',
                route: expect.objectContaining({
                    name:'Free Ride'
                }),
                logs:[]
            })
            
        })
        test('Video from start of route',()=>{
            // TODO  

        })
        test('Video from different start position',()=>{
            // TODO
        })

        test('calling init while activity is ongoing',async ()=>{
            const route  = createFromJson(sydney as unknown as RouteApiDetail)
            let completed1 = false
            let completed2 = false
            jest.useRealTimers()
            
            mockServices(service,{route,startSettings:{startPos:1000,realityFactor:50,type:'Route'}})

            const observer1 = service.init()          
            observer1.on('completed',()=>{completed1=true})
            await waitNextTick()

            const observer2 = service.init()          
            observer2.on('completed',()=>{completed2=true})
            await waitNextTick()

            expect(observer1).not.toBe(observer2)
            expect(completed1).toBe(true)
            expect(completed2).toBe(false)


        })
    })

    describe('typical ride',()=>{
        let service:ActivityRideService
        const ride   = new EventEmitter()

        const run = (duration, values) => {
            ride.emit('data',values)
            for (let i=0;i<100;i++) {
                jest.advanceTimersByTime(1000); 
                ride.emit('data',values)
            }
        }

        beforeEach( ()=>{
            service = new ActivityRideService()
            jest .useFakeTimers().setSystemTime(new Date('2020-01-01'));
            
        })

        afterEach( ()=>{
            service.stop()
            resetSingleton(service)
            jest.useRealTimers()
        })


        test('GPX from start of route',()=>{
            const route  = createFromJson(sydney as unknown as RouteApiDetail)

            mockServices(service,{route,startSettings:{startPos:0,realityFactor:100,type:'Route'},ride})
            const onData = jest.fn()
             
            const observer = service.init()
            observer.on('data',onData)

            service.start()
            const activity = service.getActivity()

            // processing starts when speed>0, 
            run(100,{power:150,speed:36.00,cadence:90,heartrate:149})
            
            expect(activity.time).toBe(100)
            expect(activity.distance).toBe(1000)
            expect(activity.totalElevation).toBeCloseTo(5.9,1)
            expect(activity.stats?.power.avg).toBe(150)
            const lastLog = activity.logs[activity.logs.length-1]

            expect(lastLog).toMatchObject({
                time:100, distance:1000, 
                power:150, cadence:90, speed:36, heartrate:149, 
                elevation:expect.closeTo(3,0),  slope:expect.closeTo(1.5,1),
                lat:expect.anything(), lng:expect.anything()
            })
            expect(onData).toHaveBeenCalledTimes(100)
        })


        test('GPX from start close to end of route',()=>{
            const route  = createFromJson(sydney1 as unknown as RouteApiDetail)

            mockServices(service,{route,startSettings:{startPos:3700,realityFactor:100,type:'Route'},ride})
            const onData = jest.fn()
             
            const observer = service.init()
            observer.on('data',onData)
            
            service.start()
            const activity = service.getActivity()

            // run for 100s with 10m/s
            run(100,{power:150,speed:36.00,cadence:90,heartrate:149})
           
            expect(activity.time).toBe(100)
            expect(activity.distance).toBe(1000)
            expect(activity.startPos).toBe(3700)

            expect(activity.totalElevation).toBeCloseTo(6,0)       // total elevation (29) - elevation gain at 3700m (29) + elevation gain at ~900m (6)
            expect(activity.logs[activity.logs.length-1]).toMatchObject({time:100, distance:1000,lat:expect.anything(),lng:expect.anything()})
        })


        
    })

    describe('getDashboardDisplayProperties',()=>{
        let service:ActivityRideService
        const ride   = new EventEmitter()


        beforeEach( ()=>{
            service = new ActivityRideService()
            jest .useFakeTimers().setSystemTime(new Date('2020-01-01'));
            
        })

        afterEach( ()=>{
            service.stop()
            resetSingleton(service)
            jest.useRealTimers()
        })

        test('directly after init, before activity is started',()=>{
            const route  = createFromJson(sydney as unknown as RouteApiDetail)

            mockServices(service,{route,startSettings:{startPos:0,realityFactor:100,type:'Route'},ride})
            service.init()

            const props = service.getDashboardDisplayProperties()
            
            expect(props).toMatchSnapshot()
        })

    })





    describe('getPrevRideStats',()=>{
        let service:ActivityRideService


        beforeEach( ()=>{
            service = new ActivityRideService()
            
        })

        afterEach( ()=>{
            service.stop()
            resetSingleton(service)
        })
        

        test('current ride is slower - time and distance in middle of prev ride',()=>{
            console.log(troll)
            const details = troll as ActivityDetails
            const summary = buildSummary(details,'Test')
            const activity = {summary,details}

            const data = service.getPrevRideStats([activity],{
                "time": 12.001,
                "timeDelta": 1,
                "speed": 8.216255076817461,
                "cadence": 90,
                "heartrate": 156,
                "power": 150,
                "distance": 30.900156300358663,
                "slope": 8.29999999999984,
                "elevation": 186.50471297292978
            },)


            expect (data.length).toBe(2)
            expect(data[1]?.title).toBe('current')
            expect(data[0]?.distanceGap).toBe('16m')
            expect(data[0]?.timeGap).toBe('3.7s')
        })

        test('current ride is slower - time beyond end of prev ride',()=>{
            console.log(troll)
            const details = troll as ActivityDetails
            const summary = buildSummary(details,'Test')
            const activity = {summary,details}

            const data = service.getPrevRideStats([activity],{
                "time": 48.001,
                "timeDelta": 1,
                "speed": 2.05,
                "cadence": 90,
                "heartrate": 156,
                "power": 15,
                "distance": 13,
                "slope": 8.29999999999984,
                "elevation": 186.50471297292978
            },)


            expect (data.length).toBe(2)
            expect(data[1]?.title).toBe('current')
            expect(data[0]?.distanceGap).toBe('110m')
            expect(data[0]?.timeGap).toBe('44.1s')
        })

        test('current ride is slower - distance beyond end of prev ride',()=>{
            console.log(troll)
            const details = troll as ActivityDetails
            const summary = buildSummary(details,'Test')
            const activity = {summary,details}

            const data = service.getPrevRideStats([activity],{
                "time": 90.001,
                "timeDelta": 1,
                "speed": 2.05,
                "cadence": 90,
                "heartrate": 156,
                "power": 15,
                "distance": 130,
                "slope": 8.29999999999984,
                "elevation": 186.50471297292978
            },)


            expect (data.length).toBe(0)
            
        })

        test('current ride is faster - time and distance in middle of ride',()=>{
            console.log(troll)
            const details = troll as ActivityDetails
            const summary = buildSummary(details,'Test')
            const activity = {summary,details}

            const data = service.getPrevRideStats([activity],{
                "time": 12.001,
                "timeDelta": 1,
                "speed": 8.216255076817461,
                "cadence": 90,
                "heartrate": 156,
                "power": 150,
                "distance": 56.9,
                "slope": 8.29999999999984,
                "elevation": 186.50471297292978
            },)


            expect (data.length).toBe(2)
            expect(data[0]?.title).toBe('current')
            expect(data[1]?.distanceGap).toBe('-10m')
            expect(data[1]?.timeGap).toBe('-2.5s')
        })

        test('current ride is faster - time and distance beyond duration of prev ride',()=>{
            console.log(troll)
            const details = troll as ActivityDetails
            const summary = buildSummary(details,'Test')
            const activity = {summary,details}

            const data = service.getPrevRideStats([activity],{
                "time": 28.001,
                "timeDelta": 1,
                "speed": 8.216255076817461,
                "cadence": 90,
                "heartrate": 156,
                "power": 150,
                "distance": 156.9,
                "slope": 8.29999999999984,
                "elevation": 186.50471297292978
            },)


            expect (data.length).toBe(0)
        })

    })

})