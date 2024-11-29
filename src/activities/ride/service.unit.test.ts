import { ActivityRideService } from "./service"
import sydney from '../../../__tests__/data/routes/sydney.json'
import video from '../../../__tests__/data/routes/demo.json'
import sydney1 from '../../../__tests__/data/routes/sydney1.json'
import { createFromJson} from "../../routes/base/utils/route"
import { RouteApiDetail } from "../../routes/base/api/types"
import { EventEmitter } from "stream"
import { waitNextTick } from "../../utils"


import troll from '../../../__tests__/data/activities/troll-90.json'
import prev2 from '../../../__tests__/data/activities/prevRide1.json'
import { ActivityDetails, ActivityInfo, buildSummary, DB_VERSION } from '../base'
import { PastActivityLogEntry } from "../list"
import { Observer } from "../../base/types/observer"


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

    const protectedMember = (service,member) => service[member]

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

        if (props.observer) {
            svc.createObserver = jest.fn().mockReturnValue(props.observer)
        }
        if (props.init) {
            const keys = Object.keys(props.init)
            keys.forEach( key => svc[key]=props.init[key])
        }

    
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
            jest.resetAllMocks();
            jest.useRealTimers()
        })


        test('XML from start of route',()=>{
            const route  = createFromJson(sydney as unknown as RouteApiDetail)
            mockServices(service,{route,startSettings:{startPos:0,realityFactor:100,type:'Route'}})
            const observer = service.init()
            expect(observer).toBeDefined()
            expect(service.getActivity()).toMatchObject({
                type:'IncyclistActivity',
                version: DB_VERSION,
                id: expect.anything(),
                distance:0,time:0, totalElevation:0,
                startPos: 0,
                realityFactor:100,
                name: 'Incyclist Ride-20200101000000',
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
                version: DB_VERSION,
                id: expect.anything(),
                distance:0,time:0, totalElevation:0,
                startPos: 0,
                realityFactor:0,
                name: 'Incyclist Ride-20200101000000',
                routeType: 'Free-Ride',
                route: expect.objectContaining({
                    name:'Free Ride'
                }),
                logs:[]
            })
            
        })
        test('Video from start of route',()=>{
            const route  = createFromJson(video as unknown as RouteApiDetail)
            route.description.originalName = 'XX_DEMO'
            route.description.routeHash = '123'
            route.description.id = '4711'

            mockServices(service,{route,startSettings:{startPos:0,realityFactor:100,type:'Route'}})
            const observer = service.init()
            expect(observer).toBeDefined()
            expect(service.getActivity()).toMatchObject({
                distance:0,time:0, totalElevation:0,
                startPos: 0,
                realityFactor:100,
                logs:[],
                version:DB_VERSION,
                startTime:'2020-01-01T00:00:00.000Z',
                route:{name:'XX_DEMO',id:'4711',hash:'123'}
            })

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

    describe ('start',()=>{
        let service:ActivityRideService
        let settings
        let observer:Observer
        const ride   = new EventEmitter()

        beforeEach( ()=>{
            observer = new Observer()
            service = new ActivityRideService()
            jest .useFakeTimers().setSystemTime(new Date('2020-01-01'));
            const route  = createFromJson(sydney as unknown as RouteApiDetail)
            mockServices(service,{route,startSettings:{startPos:0,realityFactor:100,type:'Route'},ride,observer})
        })

        afterEach( ()=>{
            service.stop()
            resetSingleton(service)
            jest.resetAllMocks();
            jest.useRealTimers()

        })

        test('normal start after init',()=>{
            const obs = service.init('123')
            let isStarted = false;            
            obs.on('started',()=>{isStarted=true})
            service.start()

            const activity = protectedMember(service,'activity')
            expect(activity?.id).toBe('123')    
            expect(activity.startTime).toBe('2020-01-01T00:00:00.000Z')

        })

        test('start called before init',async ()=>{         
            
            const initFn = jest.spyOn(service,'init')

            let isStarted = false;            
            observer.on('started',()=>{isStarted=true})

            service.start()
            expect(initFn).toHaveBeenCalled()
            const activity = protectedMember(service,'activity')
            expect(activity?.id).toBeDefined()    
            expect(isStarted).toBeTruthy()


        })

        test('trying to start while an acitivity is active',()=>{

            let startCount = 0;

            const obs = service.init('124')
            obs.on('started',()=>{startCount++})

            // first start
            service.start()
            const state = protectedMember(service,'state')
            expect(state).toBe('active')

            jest.advanceTimersByTime(1000*60*60)

            // 2nd start
            service.start()
            expect(startCount).toBe(1)
            const activity = protectedMember(service,'activity')
            expect(activity.startTime).toBe('2020-01-01T00:00:00.000Z')

        })


    
    })

    describe ('pause/resume',()=>{
        let service:ActivityRideService
        let settings
        let observer:Observer
        const route  = createFromJson(sydney as unknown as RouteApiDetail)

        beforeEach( ()=>{
            observer = new Observer()
            service = new ActivityRideService()
            jest .useFakeTimers().setSystemTime(new Date('2020-01-01'));
        })

        afterEach( ()=>{
            service.stop()
            resetSingleton(service)
            jest.resetAllMocks();
            jest.useRealTimers()

        })

        test('pausing active acitvity',()=>{
            const activity:Partial<ActivityDetails> = {id:'123',startTime:'2020-01-01T00:00:00.000Z'} 
            mockServices(service,{route,startSettings:{startPos:0,realityFactor:100,type:'Route'}, 
                init:{
                    state:'active',tsStart:Date.now(),
                    activity,observer
                }
            })
            let isPaused = false
            jest.advanceTimersByTime(1000)
            observer.on('paused',()=>{isPaused=true})
            service.pause()

            expect(activity.startTime).toBe('2020-01-01T00:00:00.000Z')
            expect(activity.timeTotal).toBe(1)
            expect(activity.time).toBe(1)
            expect(activity.timePause).toBeUndefined()

            jest.advanceTimersByTime(1000)
            service.stop()
            expect(activity.timeTotal).toBe(2)
            expect(activity.time).toBe(1)
            expect(activity.timePause).toBe(1)

        })


        test('pausing paused acitvity',()=>{
            const activity:Partial<ActivityDetails> = {id:'123',startTime:'2020-01-01T00:00:00.000Z'} 
            mockServices(service,{route,startSettings:{startPos:0,realityFactor:100,type:'Route'}, 
                init:{
                    state:'paused',tsStart:Date.now(),
                    activity,observer
                }
            })
            let isPausedEmitted = false
            jest.advanceTimersByTime(1000)
            observer.on('paused',()=>{isPausedEmitted=true})
            service.pause()

            expect(isPausedEmitted).toBeFalsy()
        })


        test('resuming paused acitvity',()=>{
            const activity:Partial<ActivityDetails> = {id:'123',startTime:'2020-01-01T00:00:00.000Z'} 
            mockServices(service,{route,startSettings:{startPos:0,realityFactor:100,type:'Route'}, 
                init:{
                    state:'active',tsStart:Date.now(),
                    activity,observer
                }
            })
            let isPaused = false
            jest.advanceTimersByTime(1000)
            observer.on('paused',()=>{isPaused=true})
            service.pause()

            jest.advanceTimersByTime(1000)
            service.resume()

            jest.advanceTimersByTime(1000)
            service.stop()
            expect(activity.timeTotal).toBe(3)
            expect(activity.time).toBe(2)
            expect(activity.timePause).toBe(1)

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

    describe('ActiveRideService', () => {
        let service: ActivityRideService;
        let s
        beforeEach(() => {
          s = service = new ActivityRideService();
        });
      
        test('Free ride', () => {


            const path =[
                {lat: 40.28908245275464, lng: 23.389428365252346,elevation: 0.1061634434781438,routeDistance:0},
                {lat: 40.289108886192935, lng: 23.389433183088087,elevation: 0.18467297903991475,routeDistance:3 }
                ]               

            mockServices(service,{startSettings:{startPos:0,realityFactor:100,type:'Free-Ride',option:{path}}})
          
      
          // Act
          const props = service.getActivitySummaryDisplayProperties();
      
          // Assert
          expect(props.showMap).toBeTruthy()
        });
    })

    describe('getPrevRideStats',()=>{
        let service:ActivityRideService
        let svc

        const template = {
            time: 48.001,
            distance: 13,
            routeDistance: 13,
            timeDelta: 1,
            speed:0,
            power:0,

        }
        const current = (time,distance) => {
            return {...template, time,distance,routeDistance:distance}
        }

        beforeEach( ()=>{
            svc = service = new ActivityRideService()
            
        })

        afterEach( ()=>{
            service.stop()
            resetSingleton(service)
        })
        

        test('current ride is slower - time and distance in middle of prev ride',()=>{
            const details = troll as ActivityDetails
            const summary = buildSummary(details,'Test')
            const activity = {summary,details}
            
            svc.current.prevRides = [activity]
            const data = service.getPrevRideStats(current(12.011,30.900156300358663))

            expect (data.length).toBe(2)
            expect(data[1]?.title).toBe('current')
            expect(data[0]?.distanceGap).toBe('-16m')
            expect(data[0]?.timeGap).toBe('-3.7s')
        })

        test('bug: time and distance contradict',()=>{
            
            const activities: Array<ActivityInfo> = []
            
            activities.push( {summary: buildSummary(prev2 as ActivityDetails,'2'), details:prev2 as ActivityDetails})
            
            let data

            svc.current.prevRides = activities
            data = service.getPrevRideStats(current(16.001,74.99548756151944))
            data = service.getPrevRideStats(current(17.001,80.91931132633276))

            const res = data.find(a=>a.title==='6/19/2024')
            
            expect(res?.distanceGap).toBe('-1m')
            expect(res?.timeGap).toBe('-0.2s')
        })

        test('current ride is slower - time beyond end of prev ride',()=>{
            const details = troll as ActivityDetails
            const summary = buildSummary(details,'Test')
            const activity = {summary,details}

            svc.current.prevRides = [activity]
            const data = service.getPrevRideStats(current(48.001,13))

            expect (data.length).toBe(2)
            expect(data[1]?.title).toBe('current')
            expect(data[0]?.distanceGap).toBe('-110m')
            expect(data[0]?.timeGap).toBe('-44.1s')
        })

        test('current ride is slower - distance beyond end of prev ride',()=>{
            const details = troll as ActivityDetails
            const summary = buildSummary(details,'Test')
            const activity = {summary,details}

            svc.current.prevRides = [activity]
            const data = service.getPrevRideStats(current(90.001, 130))


            expect (data.length).toBe(0)
            
        })

        test('current ride is faster - time and distance in middle of ride',()=>{
            const details = troll as ActivityDetails
            const summary = buildSummary(details,'Test')
            const activity = {summary,details}

            svc.current.prevRides = [activity]
            const data = service.getPrevRideStats(current(12.001, 56.9))

            expect (data.length).toBe(2)
            expect(data[0]?.title).toBe('current')
            expect(data[1]?.distanceGap).toBe('+10m')
            expect(data[1]?.timeGap).toBe('+2.5s')
        })

        test('current ride is faster - time and distance beyond duration of prev ride',()=>{
            const details = troll as ActivityDetails
            const summary = buildSummary(details,'Test')
            const activity = {summary,details}

            svc.current.prevRides = [activity]
            const data = service.getPrevRideStats(current(28.001, 156.9))

            expect (data.length).toBe(0)
        })

    })

    describe('getPrevRidesListDisplay',()=>{
        let service:ActivityRideService
        let svc

        const template:PastActivityLogEntry = {tsStart:1, title:'', routeDistance:1, timeGap:'', distanceGap:''} 

        const prepareList = (cnt:number,posCurrent:number)  =>{
            const prevRidesLogs:Array<PastActivityLogEntry> =[]
            for(let i=0;i<cnt;i++) {
                prevRidesLogs.push( {...template, routeDistance:1000-i*10, title:`${i+1}`})

            }
            prevRidesLogs[posCurrent-1].title = 'current'
            svc.current = {prevRidesLogs}

        }

        const getList = (l) => l.map(e=>e.title).join(',')

        beforeEach( ()=>{
            svc = service = new ActivityRideService()
        })

        afterEach( ()=>{
            service.stop()
            resetSingleton(service)            
        })

        test('less than max entries',()=>{
            prepareList(5,3)

            const res = service.getPrevRidesListDisplay(5)
            expect(res.length).toBe(5)
            expect(getList(res)).toBe('1,2,current,4,5')           
        })
        test('exactly max entries',()=>{
            prepareList(5,5)

            const res = service.getPrevRidesListDisplay(5)
            expect(res.length).toBe(5)
            expect(getList(res)).toBe('1,2,3,4,current')           
        })

        test('max+1 entries, current is max+1',()=>{
            prepareList(6,6)

            const res = service.getPrevRidesListDisplay(5)            
            expect(getList(res)).toBe('1,2,3,4,current')           
        })
        test('max+1 entries, current is last but one',()=>{
            prepareList(6,5)

            const res = service.getPrevRidesListDisplay(5)
            expect(getList(res)).toBe('1,2,3,current,6')           
        })
        test('max+1 entries, current is last but two',()=>{
            prepareList(6,4)

            const res = service.getPrevRidesListDisplay(5)
            expect(getList(res)).toBe('1,2,3,current,+2')           
        })
        test('max+10 entries, current is somewhere in the middle',()=>{
            prepareList(15,7)

            const res = service.getPrevRidesListDisplay(5)
            expect(getList(res)).toBe('1,2,3,current,+8')           
        })
        test('max+10 entries, current=maxEntries',()=>{
            prepareList(15,5)

            const res = service.getPrevRidesListDisplay(5)
            expect(getList(res)).toBe('1,2,3,current,+10')           
        })
        test('max+10 entries, current=maxEntries-1',()=>{
            prepareList(15,4)

            const res = service.getPrevRidesListDisplay(5)
            expect(getList(res)).toBe('1,2,3,current,+11')           
        })
        test('max+10 entries, current=total-1',()=>{
            prepareList(15,14)

            const res = service.getPrevRidesListDisplay(5)
            expect(getList(res)).toBe('1,2,3,current,15')           
        })



    })

})