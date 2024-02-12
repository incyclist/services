
import { Workout, WorkoutCard } from '..'
import { CardList } from '../../base/cardlist'
import { Observer } from '../../base/types/observer'
import { waitNextTick } from '../../utils'
import { WorkoutListService } from './service'
import { WP } from './types'

describe('WorkoutListService',()=>{

    describe('constructor and getters',()=>{
        let s,service
        afterAll( ()=>{
            s.reset()
        })

        test('create service',()=>{
            s = service = new WorkoutListService()

            expect(service.getLanguage()).toBe('en')
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
            s = service = new WorkoutListService()
            s.logError = jest.fn()
        })
        
        afterEach( ()=>{
            s.reset()
        })

        test('initialized, but not workouts/lists',async ()=>{
            s.initialized = true;

            const res = service.open()
            const o = res.observer
            o.emit = jest.fn()

            expect(res).toEqual({observer:expect.any(Observer), lists:expect.any(Array<CardList<WP>>)})            
            expect(res.lists.map(l=>l.getTitle())).toEqual(['My Workouts'])
            expect(res.lists.map(l=>l.getCards().map(c=>c.getTitle()).join(','))).toEqual(['Import Workout'])

            await waitNextTick()
            expect(o.emit).toHaveBeenCalledWith('started')
            expect(o.emit).not.toHaveBeenCalledWith('loaded')
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
            expect(res.lists.map( l=>l.getCards().map(c=>c.getTitle()).join(',')  )) .toEqual(['Import Workout,1,2'])

            await waitNextTick()
            expect(o.emit).toHaveBeenCalledWith('started')

            await waitNextTick()
            expect(o.emit).not.toHaveBeenCalledWith('loaded')

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
            expect(res.lists.map( l=>l.getCards().map(c=>c.getTitle()).join(',')  )) .toEqual(['Import Workout,1','2'])

            await waitNextTick()
            expect(o.emit).toHaveBeenCalledWith('started')

            await waitNextTick()
            expect(o.emit).not.toHaveBeenCalledWith('loaded')

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
            expect(o.emit).toHaveBeenCalledWith('loaded',s.lists,'Import')

        })


        test('error',()=>{
            
            s.getLists = jest.fn( ()=> {  throw new Error() })

            const res = service.open()

            expect(s.logError).toHaveBeenCalled()
            expect(res).toEqual({observer:undefined, lists:null})
        })

    })

    describe('openSettings',()=>{})
    describe('getStartSettings',()=>{})

    describe('onResize',()=>{})

    describe('onCarouselInitialized',()=>{})

    describe('onCarouselUpdated',()=>{})

    describe ('preLoad',()=>{})
    describe ('import',()=>{})
    describe ('addList',()=>{})
    describe ('getLists',()=>{})
    describe ('getLists',()=>{})
    describe ('emitLists',()=>{})
    describe ('select',()=>{})
    describe ('unselect',()=>{})

    describe ('selectCard',()=>{})
    describe ('unselectCard',()=>{})
    describe ('moveCard',()=>{})

    describe ('canDisplayStart',()=>{})
    
})
