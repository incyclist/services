
import { sleep } from 'incyclist-devices/lib/utils/utils'
import { Workout, WorkoutCard } from '..'
import { Card, CardList } from '../../base/cardlist'
import { Observer } from '../../base/types/observer'
import { waitNextTick } from '../../utils'
import { WorkoutListService } from './service'
import { WP } from './types'
import { FileInfo } from '../../api'
import { Inject } from '../../base/decorators'

describe('WorkoutListService',()=>{

    const setupMocks = ()=> {
    

        const MockCalendar = {
            on: jest.fn(),
            off: jest.fn(),
            once: jest.fn(),
            init: jest.fn(),
            setActive: jest.fn(),
            getScheduledWorkouts: jest.fn().mockReturnValue([]),
            reset: jest.fn()
        }
        const MockAppState = {
            setState: jest.fn(),
            setPersistedState: jest.fn().mockReturnValue({}),
            getState: jest.fn()
        }
        Inject('WorkoutCalendar', MockCalendar)
        Inject('AppState', MockAppState)
    }

    const resetMocks = () => {
        Inject('WorkoutCalendar', null)
        Inject('AppState', null)
    }

    describe('constructor and getters',()=>{
        let s,service

        beforeEach( ()=>{
            setupMocks()
        })
        afterEach( ()=>{
            resetMocks()
        })

        afterAll( ()=>{
            s.reset()
        })

        test('create service',()=>{
            s = service = new WorkoutListService()

            expect(service.getSelected()).toBeUndefined()
            expect(service.getScreenProps()).toBeUndefined()
            expect(service.getLists()).toBeNull()
            expect(service.getLists(false).map(l=>l.getTitle())).toEqual(['My Workouts'])

            expect(s.initialized).toBe(false)
            expect(s.observer).toBeUndefined()
        })

    })

    describe('open',()=>{
        let s,service

        beforeEach( ()=>{
            setupMocks()
            s = service = new WorkoutListService()
            s.logError = jest.fn()
        })
        
        afterEach( ()=>{
            resetMocks()
            s.reset()
        })

        test('initialized, but not workouts/lists',async ()=>{
            s.initialized = true;

            const res = service.open()
            const o = res.observer
            o.emit = jest.fn()

            expect(res).toEqual({observer:expect.any(Observer), lists:expect.any(Array<CardList<WP>>)})            
            expect(res.lists.map(l=>l.getTitle())).toEqual(['My Workouts'])
            expect(res.lists.map(l=>l.getCards().map(c=>c.getTitle()).join(','))).toEqual(['Import Workout,Create Workout'])

            await waitNextTick()
            expect(o.emit).toHaveBeenCalledWith('started')

            await waitNextTick()
            
            expect(o.emit).not.toHaveBeenCalledWith('loaded')
            expect(o.emit).not.toHaveBeenCalledWith('loading')
        })

        test('initialized, multiple workouts in single list',async ()=>{
            s.initialized = true;
            const c1 = new WorkoutCard( new Workout({type:'workout',id:'1',name:'1'}))
            const c2 = new WorkoutCard( new Workout({type:'workout',id:'2',name:'2'}))
            s.myWorkouts.add(c1)
            s.myWorkouts.add(c2)


            const res = service.open()
            const o = res.observer
            o.emit = jest.fn()

            expect(res).toEqual({observer:expect.any(Observer), lists:expect.any(Array<CardList<WP>>)})            
            expect(res.lists.map(l=>l.getTitle())).toEqual(['My Workouts'])
            expect(res.lists.map( l=>l.getCards().map(c=>c.getTitle()).join(',')  )) .toEqual(['Import Workout,Create Workout,1,2'])

            await waitNextTick()
            expect(o.emit).toHaveBeenCalledWith('started')

            await waitNextTick()
            expect(o.emit).not.toHaveBeenCalledWith('loaded')
            expect(o.emit).not.toHaveBeenCalledWith('loading')
        })


        test('2nd call',async ()=>{
            s.initialized = true;
            const c1 = new WorkoutCard( new Workout({type:'workout',id:'1',name:'1'}))
            const c2 = new WorkoutCard( new Workout({type:'workout',id:'2',name:'2'}))
            s.myWorkouts.add(c1)
            s.myWorkouts.add(c2)

            const res = service.open()
            const o = res.observer
            o.emit = jest.fn()
            await waitNextTick()

            // short pause
            await sleep(100)
            jest.clearAllMocks()

            // 2nd call
            const res1 = service.open()
            expect(res1.observer).toBe(res.observer)

            await waitNextTick()
            expect(o.emit).not.toHaveBeenCalledWith('started')


        })

        test('initialized, multiple workouts in multiple lists',async ()=>{
            s.initialized = true;
            const l1 = new CardList<WP>('l1','List#1')

            const c1 = new WorkoutCard( new Workout({type:'workout',id:'1',name:'1'}))
            const c2 = new WorkoutCard( new Workout({type:'workout',id:'2',name:'2'}))
            s.lists.push(l1)

            s.myWorkouts.add(c1)
            l1.add(c2)

            const res = service.open()
            const o = res.observer
            o.emit = jest.fn()

            expect(res).toEqual({observer:expect.any(Observer), lists:expect.any(Array<CardList<WP>>)})            
            expect(res.lists.map(l=>l.getTitle())).toEqual(['My Workouts','List#1'])
            expect(res.lists.map( l=>l.getCards().map(c=>c.getTitle()).join(',')  )) .toEqual(['Import Workout,Create Workout,1','2'])

            await waitNextTick()
            expect(o.emit).toHaveBeenCalledWith('started')

            await waitNextTick()
            expect(o.emit).not.toHaveBeenCalledWith('loaded')
            expect(o.emit).not.toHaveBeenCalledWith('loading')

        })

        test('not initialized',async ()=>{
            s.loadWorkouts = jest.fn( async ()=>{ return;}) 

            const res = service.open()
            const o = res.observer
            o.emit = jest.fn()

            expect(res).toEqual({observer:expect.any(Observer), lists:null})            

            await waitNextTick()
            expect(o.emit).toHaveBeenCalledWith('started')

            await waitNextTick()
            expect(o.emit).not.toHaveBeenCalledWith('updated')
            expect(o.emit).toHaveBeenCalledWith('loading')
            expect(o.emit).toHaveBeenCalledWith('loaded',s.lists,'Import,Create')

        })


        test('error',()=>{
            
            s.getLists = jest.fn( ()=> {  throw new Error() })

            const res = service.open()

            expect(s.logError).toHaveBeenCalled()
            expect(res).toEqual({observer:undefined, lists:null})
        })

    })

    describe('openSettings',()=>{
        let s,service

        beforeEach( ()=>{
            setupMocks()
            s = service = new WorkoutListService()
            s.logError = jest.fn()
        })
        
        afterEach( ()=>{
            resetMocks()
            s.reset()
        })

        test('initialized, but not workouts/lists',async ()=>{
            s.initialized = true;

            const res = service.openSettings()
            const o = res.observer
            o.emit = jest.fn()

            expect(res).toEqual({observer:expect.any(Observer), workouts:expect.any(CardList<WP>),selected:undefined, settings:{ftp:200,useErgMode:true}})            
            expect(res.workouts.getCards().map(c=>c.getTitle()).join(',')).toEqual('Import Workout')

            await waitNextTick()
            expect(o.emit).toHaveBeenCalledWith('started')

            await waitNextTick()
            expect(o.emit).not.toHaveBeenCalledWith('updated',expect.anything(), expect.anything())
            expect(o.emit).not.toHaveBeenCalledWith('loaded')
            expect(o.emit).not.toHaveBeenCalledWith('loading')
        })

        test('initialized, multiple workouts in single list',async ()=>{
            s.initialized = true;
            s.addItem(new Workout({type:'workout',id:'1',name:'1'}))
            s.addItem(new Workout({type:'workout',id:'2',name:'2'}))


            const res = service.openSettings()
            const o = res.observer
            o.emit = jest.fn()

            expect(res).toEqual({observer:expect.any(Observer), workouts:expect.any(CardList<WP>),selected:undefined, settings:{ftp:200,useErgMode:true}})            
            expect(res.workouts.getCards().map(c=>c.getTitle()).join(',')).toEqual('Import Workout,1,2')

            await waitNextTick()
            expect(o.emit).toHaveBeenCalledWith('started')

            await waitNextTick()
            expect(o.emit).not.toHaveBeenCalledWith('updated',expect.anything(), expect.anything())
            expect(o.emit).not.toHaveBeenCalledWith('loaded')
            expect(o.emit).not.toHaveBeenCalledWith('loading')
        })


        test('2nd call',async ()=>{
            s.initialized = true;
            s.addItem(new Workout({type:'workout',id:'1',name:'1'}))
            s.addItem(new Workout({type:'workout',id:'2',name:'2'}))

            const res = service.open()
            const o = res.observer
            o.emit = jest.fn()
            await waitNextTick()

            // short pause
            await sleep(100)
            jest.clearAllMocks()

            // 2nd call
            const res1 = service.openSettings()
            expect(res1.observer).toBe(res.observer)

            await waitNextTick()
            expect(o.emit).not.toHaveBeenCalledWith('started')
            await waitNextTick()
            expect(o.emit).not.toHaveBeenCalledWith('updated',expect.anything(),expect.anything())


        })

        test('initialized, multiple workouts in multiple lists',async ()=>{
            s.initialized = true;
            const l1 = new CardList<WP>('l1','List#1')
            s.lists.push(l1)

            s.addItem(new Workout({type:'workout',id:'1',name:'1'}))
            s.addItem(new Workout({type:'workout',id:'2',name:'2',category:{name:'List#1'}}))


            const res = service.openSettings()
            const o = res.observer
            o.emit = jest.fn()

            expect(res).toEqual({observer:expect.any(Observer), workouts:expect.any(CardList<WP>),selected:undefined, settings:{ftp:200,useErgMode:true}})            
            expect(res.workouts.getCards().map(c=>c.getTitle()).join(',')).toEqual('Import Workout,1,2')

        })

        test('not initialized',async ()=>{
            s.loadWorkouts = jest.fn( async ()=>{ return;}) 

            const res = service.openSettings()
            const o = res.observer
            o.emit = jest.fn()

            expect(res).toEqual({observer:expect.any(Observer), workouts:null})            

            await waitNextTick()
            expect(o.emit).toHaveBeenCalledWith('started')

            await waitNextTick()
            expect(o.emit).not.toHaveBeenCalledWith('updated')
            expect(o.emit).toHaveBeenCalledWith('loading')
            expect(o.emit).toHaveBeenCalledWith('loaded',s.lists,'Import,Create')

        })


        test('error',()=>{
            
            s.emitStartEvent = jest.fn( ()=> {  throw new Error() })

            const res = service.openSettings()

            expect(s.logError).toHaveBeenCalled()
            expect(res).toEqual({observer:expect.anything(), workouts:undefined, selected:undefined, settings:undefined})
        })

    })

    describe('get/set StartSettings',()=>{
        let s,service
        let user
        let ergPref
        beforeEach( ()=>{
            setupMocks()

            s = service = new WorkoutListService()
            s.getUserSettings = jest.fn().mockReturnValue( {
                get:jest.fn( (key,defValue)=> { 
                    if (key==='user') return user??defValue 
                    if (key==='preferences.useErgMode') return ergPref??defValue 
                    return defValue
                }),
                set:jest.fn( (key,value)=>{
                    if (key==='preferences.useErgMode') ergPref=value
                })
            })
            s.logError = jest.fn()
        })
        
        afterEach( ()=>{
            resetMocks()
            s.reset()
            user = undefined
            ergPref = undefined
        })

        test('user with ftp and ergMode preference',()=>{
            user = {ftp:250}
            ergPref  =false
            let settings = service.getStartSettings()
            expect(settings).toEqual({ftp:250, useErgMode:false} )

            // start settings were changed by user
            service.setStartSettings({ftp:200, useErgMode:true})
            settings = service.getStartSettings()
            expect(settings).toEqual({ftp:200, useErgMode:true} )
            expect(s.getUserSettings().set).toHaveBeenCalledWith('preferences.useErgMode',true)

            // simulate event that user changed FTP in user settings, while overrule temporary settings
            s.onUserUpdate({ftp:300} )
            settings = service.getStartSettings()
            expect(settings).toEqual({ftp:300, useErgMode:true} )

        })

        test('user with ftp but no ergMode preference',()=>{
            user = {ftp:250}
            let settings = service.getStartSettings()
            expect(settings).toEqual({ftp:250, useErgMode:true} )

            // start settings were changed by user
            service.setStartSettings({ftp:200, useErgMode:false})
            settings = service.getStartSettings()
            expect(settings).toEqual({ftp:200, useErgMode:false} )
            expect(s.getUserSettings().set).toHaveBeenCalledWith('preferences.useErgMode',false)

            // simulate event that user changed FTP in user settings, while overrule temporary settings
            s.onUserUpdate({ftp:300} )
            settings = service.getStartSettings()
            expect(settings).toEqual({ftp:300, useErgMode:false} )

        })

        test('user without ftp or ergMode proference',()=>{
            let settings = service.getStartSettings()
            expect(settings).toEqual({ftp:200, useErgMode:true} )

            // start settings were changed by user
            service.setStartSettings({ftp:210, useErgMode:false})
            settings = service.getStartSettings()
            expect(settings).toEqual({ftp:210, useErgMode:false} )
            expect(s.getUserSettings().set).toHaveBeenCalledWith('preferences.useErgMode',false)

            // simulate event that user changed FTP in user settings, while overrule temporary settings
            s.onUserUpdate({ftp:300} )
            settings = service.getStartSettings()
            expect(settings).toEqual({ftp:300, useErgMode:false} )

        })
        test('error',()=>{
            s.getUserSettings = jest.fn( ()=>{throw new Error})

            service.getStartSettings()
            expect(s.logError).toHaveBeenCalled()

            service.setStartSettings({ftp:210, useErgMode:false})
            expect(s.logError).toHaveBeenCalled()
        })


    })
    
    describe('onResize',()=>{
        let s,service
        beforeEach( ()=>{
            setupMocks()
            s = service = new WorkoutListService()
            s.logError = jest.fn()
        })
        
        afterEach( ()=>{
            resetMocks()  
            s.reset()
        })

        test('resize',()=>{
            const c1 = s.addItem(new Workout({type:'workout',id:'1',name:'1'}))
            const c2 = s.addItem(new Workout({type:'workout',id:'2',name:'2'}))

            c1.setVisible(true)
            c2.setVisible(true)

            service.onResize()

            expect(c1.isVisible()).toBe(false)
            expect(c2.isVisible()).toBe(false)

        })

        test('error',()=>{
            s.resetCards = jest.fn( ()=>{ throw new Error()})

            service.onResize()
            expect(s.logError).toHaveBeenCalled()

        })


    })

    describe('onCarouselInitialized',()=>{
        let s,service
        beforeEach( ()=>{
            setupMocks()
            s = service = new WorkoutListService()
            s.logError = jest.fn()

        })
        
        afterEach( ()=>{
            resetMocks()
            s.reset()
        })

        test('single carousel',async ()=>{
            s.getInitTimeout = ()=>10

            const cards: Card<WP>[] = []
            for (let i=0;i<10;i++) {
                const c = s.addItem(new Workout({type:'workout',id:`${i+1}`,name:`${i+1}`}))
                c.setVisible(false)
                cards.push(c)
            }
                

            const list = service.getLists(false)[0]
            service.onCarouselInitialized( list, 0,6)

            // 21 cards ( Import card + Create Card + 10)
            // 8 Cards will be visible (6+2), i.e import card + create card +card[0]...card[5]
            expect( cards[0].isVisible()).toBe(true)
            expect( cards[5].isVisible()).toBe(true)
            expect( cards[6].isVisible()).toBe(false)
            expect( cards[7].isVisible()).toBe(false)
            expect( cards[8].isVisible()).toBe(false)
            expect( cards[9].isVisible()).toBe(false)

            // wait a bit (so that carousel can be rendered)
            await sleep(100)

            // update event was triggered, all cards should now be visible
            expect( cards[7].isVisible()).toBe(true)
            expect( cards[8].isVisible()).toBe(true)
            expect( cards[9].isVisible()).toBe(true)


        })

        test('error',()=>{
            const list = service.getLists(false)[0]
            list.getCards = jest.fn( ()=>{ throw new Error()})
            service.onCarouselInitialized( list, 0,6)

            expect(s.logError).toHaveBeenCalled()

        })


    })

    describe('onCarouselUpdated',()=>{})

    describe ('preload',()=>{
        let s,service
        let loadError
        let loadResult
        let delay
        let eventSpy 

        beforeEach( ()=>{
            setupMocks()
            s = service = new WorkoutListService()
            s.logError = jest.fn()

            s.getRepo = jest.fn().mockReturnValue({
                load: jest.fn( ()=> {
                    const o = new Observer()
                    if (loadError) throw loadError
                    process.nextTick( async ()=>{
                        if (delay)
                            await sleep(delay)

                        const results = loadResult??[]
                        results.forEach( w=> {
                            o.emit('workout.added',w)
                        })
                        o.emit('done')
                    })
                    return o
    
                })
            })
            s.observer = new Observer()
            eventSpy = jest.spyOn(s.observer,'emit')

        })
        
        afterEach( ()=>{
            resetMocks()
            s.reset()
            loadError = undefined
            loadResult = undefined
            delay = undefined
        })

        test('success',async ()=>{
            loadResult = [
                new Workout({type:'workout',id:'1',name:'1'}),
                new Workout({type:'workout',id:'2',name:'2'}),               
                new Workout({type:'workout',id:'3',name:'3',category:{name:'Test'}})                
            ]

            expect(service.getLists()).toBeNull()

            const observer = service.preload()
            await observer.wait()
            await waitNextTick()


            expect(service.getLists().map(l=>l.getTitle()).join(',')).toEqual('My Workouts,Test')
            expect(eventSpy).toHaveBeenCalledWith('loading')
            expect(eventSpy).toHaveBeenCalledWith('loaded',expect.anything(),expect.anything())

        })
        test('concurrent starts',async ()=>{
            delay = 100
            
            const observer = service.preload()
            const observer2 = service.preload()

            expect(observer2).toBe(observer)

            await observer.wait()
            await waitNextTick()

            expect(eventSpy).toHaveBeenCalledWith('loading')
            expect(eventSpy).toHaveBeenCalledWith('loaded',expect.anything(),expect.anything())


        })

        test('error while loading',async ()=>{
            loadError = new Error('load failed')

            const observer = service.preload()

            await observer.wait()
            await sleep(50)

            expect(s.observer.emit).toHaveBeenCalledWith('loading')
            expect(s.observer.emit).not.toHaveBeenCalledWith('loaded',expect.anything(),expect.anything())
            expect(s.logError).toHaveBeenCalled()

        })

        test('generic error',async ()=>{
            s.emitLoadingEvent = jest.fn( ()=>{ throw new Error('')})

            service.preload()
            expect(s.logError).toHaveBeenCalled()
        })


    })
    describe ('import',()=>{
        let s,service
        let eventSpy
        beforeEach( ()=>{
            setupMocks()
            s = service = new WorkoutListService()
            s.initialized = true;
            s.logError = jest.fn()

            s.getRepo = jest.fn().mockReturnValue({
                 save:jest.fn()
            })
            s.observer = new Observer()
          
            eventSpy = jest.spyOn(s.observer,'emit')

        })
        
        afterEach( ()=>{
            resetMocks()
            s.reset()
            jest.resetAllMocks()
        })        

        test('single successfull import',async ()=>{
            const fileInfo:FileInfo = { type:'file', name:'test.zwo', ext:'zwo', filename:'/tmp/test.zwo', delimiter:'/', dir:'/tmp', url:undefined}
            const wo = new Workout({type:'workout',id:'3',name:'3',category:{name:'Test'}})                
            s.parse = jest.fn( ).mockResolvedValue(wo)

            const workouts  = await service.import( fileInfo)
            expect(workouts).toHaveLength(1)

            expect(eventSpy).toHaveBeenCalledWith('updated',expect.any(Array<CardList<WP>>),'Import,Create,/tmp/test.zwo')
            expect(eventSpy).toHaveBeenCalledWith('updated',expect.any(Array<CardList<WP>>),'Import,Create,3')
        })

        test('single failed import',async ()=>{
            const fileInfo:FileInfo = { type:'file', name:'test.zwo', ext:'zwo', filename:'/tmp/test.zwo', delimiter:'/', dir:'/tmp', url:undefined}
            const error = new Error('XYZ')
            s.parse = jest.fn( ).mockRejectedValue( error)

            const workouts  = await service.import( fileInfo)
            expect(workouts).toHaveLength(0)

            expect(eventSpy).toHaveBeenCalledWith('updated',expect.any(Array<CardList<WP>>),'Import,Create,/tmp/test.zwo')
            expect(eventSpy).not.toHaveBeenCalledWith('updated',expect.any(Array<CardList<WP>>),'Import,Create')
            expect(s.myWorkouts.getCards()[2]).toMatchObject({error})

        })



        test('multiple successfull imports',async ()=>{
            const fileInfo:FileInfo[] = [
                { type:'file', name:'test.zwo', ext:'zwo', filename:'/tmp/test.zwo', delimiter:'/', dir:'/tmp', url:undefined},
                { type:'url', name:'test2.zwo', ext:'zwo', filename:undefined, delimiter:'/', dir:'/tmp', url:'file:////tmp/test2.zwo'}
            ]
            const wo1 = new Workout({type:'workout',id:'3',name:'3',category:{name:'Test'}})                
            const wo2 = new Workout({type:'workout',id:'4',name:'4',category:{name:'Test1'}})                
            s.parse = jest.fn()
                .mockResolvedValueOnce(wo1)
                .mockResolvedValueOnce(wo2)

            const workouts  = await service.import( fileInfo)
            expect(workouts).toHaveLength(2)
    
            expect(eventSpy).toHaveBeenCalledWith('updated',expect.any(Array<CardList<WP>>),'Import,Create,/tmp/test.zwo')
            expect(eventSpy).toHaveBeenCalledWith('updated',expect.any(Array<CardList<WP>>),'Import,Create,/tmp/test.zwo,file:////tmp/test2.zwo')
            // the exact torder of events is a bit unclear, therefore the 3rd event might vary
            expect(eventSpy).toHaveBeenCalledWith('updated',expect.any(Array<CardList<WP>>),'Import,Create,3,4')

        })

        test('multiple failed imports',async ()=>{
            const fileInfo:FileInfo[] = [
                { type:'file', name:'test.zwo', ext:'zwo', filename:'/tmp/test.zwo', delimiter:'/', dir:'/tmp', url:undefined},
                { type:'url', name:'test2.zwo', ext:'zwo', filename:undefined, delimiter:'/', dir:'/tmp', url:'file:////tmp/test2.zwo'}
            ]
            const e1 =  new Error('1')
            const e2 = new Error('2')
            s.parse = jest.fn()
                .mockRejectedValueOnce(e1)
                .mockRejectedValueOnce(e2)

            const workouts  = await service.import( fileInfo)
            expect(workouts).toHaveLength(0)
    
            expect(eventSpy).toHaveBeenCalledWith('updated',expect.any(Array<CardList<WP>>),'Import,Create,/tmp/test.zwo')
            expect(eventSpy).toHaveBeenCalledWith('updated',expect.any(Array<CardList<WP>>),'Import,Create,/tmp/test.zwo,file:////tmp/test2.zwo')            
            expect(eventSpy).not.toHaveBeenCalledWith('updated',expect.any(Array<CardList<WP>>),'Import,Create,3,4')

            expect(s.myWorkouts.getCards()[2]).toMatchObject({error:e1})
            expect(s.myWorkouts.getCards()[3]).toMatchObject({error:e2})
        })

        test('combination of successfull and failed imports',async ()=>{
            const fileInfo:FileInfo[] = [
                { type:'file', name:'test.zwo', ext:'zwo', filename:'/tmp/test.zwo', delimiter:'/', dir:'/tmp', url:undefined},
                { type:'url', name:'test2.zwo', ext:'zwo', filename:undefined, delimiter:'/', dir:'/tmp', url:'file:////tmp/test2.zwo'}
            ]
            const wo1 = new Workout({type:'workout',id:'3',name:'3',category:{name:'Test'}})                
            const e2 = new Error('2')
            s.parse = jest.fn()
                .mockResolvedValueOnce(wo1)
                .mockRejectedValueOnce(e2)

            const workouts  = await service.import( fileInfo)
            expect(workouts).toHaveLength(1)
   
        })

        test('no importcard - single failed import',async ()=>{
            const fileInfo:FileInfo = { type:'file', name:'test.zwo', ext:'zwo', filename:'/tmp/test.zwo', delimiter:'/', dir:'/tmp', url:undefined}
            const error = new Error('XYZ')
            s.parse = jest.fn( ).mockRejectedValue( error)
            await expect( async ()=> {await service.import( fileInfo,{showImportCards:false})})
                .rejects
                .toThrow('XYZ')
        })


    })


    describe ('addList',()=>{})
    describe ('getLists',()=>{})
    describe ('getLists',()=>{})
    describe ('emitLists',()=>{})
    describe ('select',()=>{})
    describe ('unselect',()=>{})

    describe ('selectCard',()=>{
        let s,service
        const cards:Card<WP>[] = []


        beforeEach( ()=>{
            setupMocks()    
            s = service = new WorkoutListService()
            s.logError = jest.fn()
            s.observer = new Observer()
            s.initialized = true
             
            for (let i=0;i<10;i++) {
                const c = s.addItem(new Workout({type:'workout',id:`${i+1}`,name:`${i+1}`}))
                cards.push(c)
            }

        })

        afterEach( ()=>{
            resetMocks()
            s.reset()
        })

        test('nothing selected before',()=>{
            service.selectCard(cards[0])
            expect( service.getSelected()).toBe(cards[0].getData())
        })
        test('already different card selected' ,()=>{
            service.selectCard(cards[0])
            service.selectCard(cards[1])
            expect( service.getSelected()).toBe(cards[1].getData())

        })

    })
    describe ('unselectCard',()=>{})


    describe ('moveCard',()=>{
        let s,service
        const cards:Card<WP>[] = []
        let l2,l3


        beforeEach( ()=>{
            setupMocks()
            s = service = new WorkoutListService()
            s.logError = jest.fn()
            s.observer = new Observer()
            s.initialized = true
             
            for (let i=0;i<10;i++) {
                const c = s.addItem(new Workout({type:'workout',id:`${i+1}`,name:`${i+1}`}))
                cards.push(c)
            }
            l2 = new CardList<WP>('2','2')
            l3 = new CardList<WP>('3','3')
            s.lists.push(l2)
            s.lists.push(l3)



        })

        afterEach( ()=>{
            resetMocks()
            s.reset()
        })

        test('move into existig list <identified as string>',()=>{
            s.observer.emit = jest.fn()
            const list = service.moveCard( cards[0], s.myWorkouts, '2' )

            expect(list).toBe(l2)
            expect(list.getCards().length).toBe(1)
            expect(s.myWorkouts.getCards().length).toBe(11)
            expect(s.observer.emit).toHaveBeenCalledWith('updated',
                expect.arrayContaining( [ 
                    expect.objectContaining({id:'myWorkouts'}) ,
                    expect.objectContaining({id:'2'}) 
                    // list 3 is not emmitted, as it is empty
                ]),
                'Import,Create,2,3,4,5,6,7,8,9,10:1'
                )

            service.moveCard( cards[1], s.myWorkouts, '2' )
            expect(list.getCards().length).toBe(2)
            expect(s.myWorkouts.getCards().length).toBe(10)

        })

        test('move into existig list <identified as object>',()=>{
            const list =service.moveCard( cards[0], s.myWorkouts, l2 )

            expect(list).toBe(l2)
            expect(list.getCards().length).toBe(1)
            expect(s.myWorkouts.getCards().length).toBe(11)

            service.moveCard( cards[1], s.myWorkouts, l3)
            expect(list.getCards().length).toBe(1)
            expect(l3.getCards().length).toBe(1)
            expect(s.myWorkouts.getCards().length).toBe(10)

        })
        test('move into non-existing <identified as string>',()=>{
            const list = service.moveCard( cards[0], s.myWorkouts, '4' )
            expect(list).toBeUndefined()
            expect(s.myWorkouts.getCards().length).toBe(12)

        })

        test.skip('card is selected',()=>{
            service.selectCard(cards[0])

            const list = service.moveCard( cards[0], s.myWorkouts, '2' )
            expect(list).toBe(l2)
            expect(l2.selected).toBe(cards[0])

        })

        test('error',()=>{
            s.myWorkouts.remove = jest.fn( ()=>{throw new Error('')})
            service.moveCard( cards[0],s.myWorkouts, '2')
            expect(s.logError).toHaveBeenCalled()

        })

    })

    describe ('canDisplayStart',()=>{

        let s,service

        beforeEach( ()=>{
            setupMocks()
            s = service = new WorkoutListService()
        })

        afterEach( ()=>{
            resetMocks()
            s.reset()
        })
        test('no route selected',()=>{
            s.getRouteList = jest.fn().mockReturnValue({
                getSelected:jest.fn().mockReturnValue(undefined)
            })

            const canStart = service.canDisplayStart()
            expect(canStart).toBe(false)
        })

        test('route selected',()=>{
            s.getRouteList = jest.fn().mockReturnValue({
                getSelected:jest.fn().mockReturnValue( {})
            })

            const canStart = service.canDisplayStart()
            expect(canStart).toBe(true)
        })

    })
    
})
