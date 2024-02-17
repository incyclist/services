import { WorkoutListService, useWorkoutList } from '..'
import { CardList } from '../../../base/cardlist'
import { UserSettingsService, useUserSettings } from '../../../settings'
import { Workout } from '../../base/model'
import { WP } from '../types'
import {WorkoutCard} from './WorkoutCard'

describe('WorkoutCard',()=>{

    describe('constructor and getters',()=>{
        const workout = new Workout( {type:'workout',id:'123', name:'test'})
        workout.addStep( {type:'step', duration:1000, power:{min:100, max:120, type:'pct of FTP'}})
        const card = new WorkoutCard(workout)

        expect(card.getId()).toBe('123')
        expect(card.getTitle()).toBe('test')
        expect(card.getData()).toBe(workout)
        expect(card.getCardType()).toBe('Workout')
        expect(card.isVisible()).toBe(true)
        expect(card.canDelete()).toBe(true)

    })

    describe( 'openSettings',()=>{

        let list,service:WorkoutListService
        beforeEach( ()=>{
            list = service = useWorkoutList()

            service.getStartSettings = jest.fn().mockReturnValue( {ftp:123, useErgMode:true})
            service.canDisplayStart = jest.fn().mockReturnValue(true)
            service.getLists = jest.fn().mockReturnValue([])
        })
        afterEach( ()=>{
            list.reset()
        })

        test('normal workout',()=>{
            const workout = new Workout( {type:'workout'})
            workout.addStep( {type:'step', duration:1000, power:{min:100, max:120, type:'pct of FTP'}})
            const card = new WorkoutCard(workout)
            const res = card.openSettings()

            expect(res.settings).toEqual({ftp:123, useErgMode:true})
            expect(res.ftpRequired).toBe(true)
            expect(res.canStart).toBe(true)
            expect(res.duration).toBe('16:40')
            expect(res.categories).toEqual([])
            expect(res.category).toBeUndefined()

        })

        test('pct only in steps withing segement',()=>{
            const workout = new Workout( {type:'workout'})
            workout.addStep( {type:'step', duration:1000, power:{min:100, max:120, type:'watt'}})
            workout.addSegment( {type:'segment', steps:[
                {power:{min:50, max:100, type:'pct of FTP'}}
            ]})

            const card = new WorkoutCard(workout)
            const res = card.openSettings()

            expect(res.ftpRequired).toBe(true)

        })
        test('workout with absolute limits',()=>{
            const workout = new Workout( {type:'workout'})
            workout.addStep( {type:'step', duration:100, power:{min:100, max:120, type:'watt'}})
            const card = new WorkoutCard(workout)
            const res = card.openSettings()

            expect(res.ftpRequired).toBe(false)
            expect(res.duration).toBe('100s')

        })
        test('workout without power limits',()=>{
            const workout = new Workout( {type:'workout'})
            workout.addStep( {type:'step', duration:180, cadence:{min:100, max:120}})
            const card = new WorkoutCard(workout)
            const res = card.openSettings()

            expect(res.ftpRequired).toBe(false)
            expect(res.duration).toBe('3min')

        })
        test('cannot display start',()=>{
            service.canDisplayStart = jest.fn().mockReturnValue(false)

            const workout = new Workout( {type:'workout'})
            const card = new WorkoutCard(workout)
            const res = card.openSettings()

            expect(res.canStart).toBe(false)
        })

        test('with categories',()=>{
            const lists:CardList<WP>[]  = []
            lists.push( {getTitle:()=>'A'} as CardList<WP>)
            lists.push( {getTitle:()=>'B'} as CardList<WP>)
            service.getLists = jest.fn().mockReturnValue(lists)

            const workout = new Workout( {type:'workout'})
            const card = new WorkoutCard(workout)
            const res = card.openSettings()
            expect(res.categories).toEqual(['A','B'])
        })

        test('no settings',()=>{
            service.getStartSettings = jest.fn().mockReturnValue( undefined)

            const workout = new Workout( {type:'workout'})
            const card = new WorkoutCard(workout)
            const res = card.openSettings()

            expect(res.settings.ftp).toBeUndefined()
            expect(res.settings.useErgMode).toBeUndefined()

        })
        test('no FTP',()=>{
            service.getStartSettings = jest.fn().mockReturnValue({useErgMode:false})

            const workout = new Workout( {type:'workout'})
            const card = new WorkoutCard(workout)
            const res = card.openSettings()

            expect(res.settings.ftp).toBeUndefined()
            expect(res.settings.useErgMode).toBe(false)

        })

    })

    describe('select',()=>{

        let list,service:WorkoutListService
        let us,settingsService:UserSettingsService
        let userSettings
        let workout
        let card

        beforeEach( ()=>{
            list = service = useWorkoutList()
            us = settingsService = useUserSettings()

            let _selected
            service.selectCard = jest.fn( (card)=>{_selected=card.getData()})
            service.getSelected = jest.fn( ()=>_selected)
            service.setStartSettings = jest.fn()

            settingsService.get = jest.fn().mockReturnValue(userSettings)

            workout = new Workout( {type:'workout',id:'1234'})
            workout.addStep( {type:'step', duration:1000, power:{min:100, max:120, type:'pct of FTP'}})   
            card = new WorkoutCard(workout)

            card.cardObserver.emit = jest.fn()

        })
        afterEach( ()=>{
            list.reset()
            us.reset()
        })

        test('normal select',()=>{           
            card.select({ftp:345, useErgMode:false})

            expect(service.selectCard).toHaveBeenCalledWith(card)
            expect(service.setStartSettings).toHaveBeenCalledWith({ftp:345, useErgMode:false})

            expect(card.cardObserver.emit).toHaveBeenCalledWith('update',expect.objectContaining({selected:true}))
        })

        test('no FTO',()=>{           
            card.select({ useErgMode:false})

            expect(service.selectCard).toHaveBeenCalledWith(card)
            expect(service.setStartSettings).toHaveBeenCalledWith({useErgMode:false})

            expect(card.cardObserver.emit).toHaveBeenCalledWith('update',expect.objectContaining({selected:true}))
        })
    })

    describe('unselect',()=>{

        let list,service:WorkoutListService
        let us,settingsService:UserSettingsService
        let userSettings
        let workout
        let card

        beforeEach( ()=>{
            list = service = useWorkoutList()
            us = settingsService = useUserSettings()

            workout = new Workout( {type:'workout',id:'1234'})
            workout.addStep( {type:'step', duration:1000, power:{min:100, max:120, type:'pct of FTP'}})   

            let _selected = workout
            service.selectCard = jest.fn( (card)=>{_selected=card.getData()})
            service.unselect = jest.fn( ()=>{_selected=undefined})
            service.getSelected = jest.fn( ()=>_selected)

            settingsService.get = jest.fn().mockReturnValue(userSettings)

            card = new WorkoutCard(workout)

            card.cardObserver.emit = jest.fn()

        })
        afterEach( ()=>{
            list.reset()
            us.reset()
        })

        test('normal',()=>{           
            card.unselect()

            expect(service.unselect).toHaveBeenCalledWith()

            expect(card.cardObserver.emit).toHaveBeenCalledWith('update',expect.objectContaining({selected:false}))
        })

    })


    describe('move',()=>{


        let list,service:WorkoutListService
        let workout
        let card
        let listAfterMove

        beforeEach( ()=>{
            list = service = useWorkoutList()

            let _selected
            service.moveCard = jest.fn( ()=> listAfterMove)
            service.getSelected = jest.fn( ()=>_selected)
            service.setStartSettings = jest.fn()


            workout = new Workout( {type:'workout',id:'1234'})
            workout.addStep( {type:'step', duration:1000, power:{min:100, max:120, type:'pct of FTP'}})   
            card = new WorkoutCard(workout)

            card.cardObserver.emit = jest.fn()
            card.save = jest.fn()
            card.list = new CardList<WP>('0','before')

        })
        afterEach( ()=>{
            list.reset()            
        })        

        test('normal',()=>{
            listAfterMove = new CardList<WP>('1','test list')

            card.move('test list')

            expect(card.list).toBe(listAfterMove)
            expect(workout.category?.name).toBe('test list')
            expect(card.save).toHaveBeenCalled()
        })
        test('no target',()=>{
            card.move()

            expect(card.list.getTitle()).toBe('before')
            expect(card.save).not.toHaveBeenCalled()

        })
        test('list unknown',()=>{
            listAfterMove = undefined

            card.move('test list')

            expect(card.list.getTitle()).toBe('before')
            expect(workout.category?.name).toBe('test list')
            expect(card.save).toHaveBeenCalled()

        })
    })

    describe('save',()=>{
        let c,card:WorkoutCard,workout
        beforeEach( ()=>{
            
            workout = new Workout( {type:'workout',id:'1234'})
            workout.addStep( {type:'step', duration:1000, power:{min:100, max:120, type:'pct of FTP'}})   
            card = c = new WorkoutCard(workout)
            c.logError = jest.fn()
        })
        
        test('success',async ()=>{
            c.getRepo = jest.fn().mockReturnValue({
                save: jest.fn( async () => {return})
            })

            await card.save()
            expect(c.getRepo().save).toHaveBeenCalledWith(workout,false)
            expect(c.logError).not.toHaveBeenCalled()
        })
        test('enforce write to db',async ()=>{
            c.getRepo = jest.fn().mockReturnValue({
                save: jest.fn( async () => {return})
            })

            await card.save(true)
            expect(c.getRepo().save).toHaveBeenCalledWith(workout,true)
            expect(c.logError).not.toHaveBeenCalled()
        })

        test('error',async ()=>{
            c.getRepo = jest.fn().mockReturnValue({
                save: jest.fn().mockRejectedValue(new Error())
            })
            
            await card.save()
            expect(c.getRepo().save).toHaveBeenCalledWith(workout,false)
            expect(c.logError).toHaveBeenCalled()
            

        })
    })

    describe('delete',()=>{
        let c,card:WorkoutCard,workout
        let s,service:WorkoutListService
        let list
        beforeEach( ()=>{
            
            workout = new Workout( {type:'workout',id:'1234'})
            workout.addStep( {type:'step', duration:1000, power:{min:100, max:120, type:'pct of FTP'}})   


            s = service = useWorkoutList()
            service.setStartSettings = jest.fn()
            service.emitLists = jest.fn()
            service.unselect = jest.fn()

            list = {
                remove:jest.fn()
            }

            card = c = new WorkoutCard(workout,{list})
            c.getDisplayProperties= jest.fn()
            c.logError = jest.fn()
            c.emitUpdate = jest.fn()
            c.getRepo = jest.fn().mockReturnValue({
                delete: jest.fn( async ()=>{return;} )
            })
        })

        afterEach( ()=>{
            s.reset()
        })
        

        test('normal',async ()=>{
            
            const observer= card.delete()
            observer.emit = jest.fn()
            const deleted = await observer.wait()

            expect(deleted).toBe(true)

            expect(service.unselect).not.toHaveBeenCalled()
            expect(service.emitLists).toHaveBeenCalledWith('updated')

            expect(list.remove).toHaveBeenCalledWith(card)

            expect(c.getRepo().delete).toHaveBeenCalledWith(workout)
            expect(c.emitUpdate).not.toHaveBeenCalled()

            expect(observer.emit).toHaveBeenCalledWith('started')
            expect(observer.emit).toHaveBeenCalledWith('done',true)
        })

        test('selected card',async ()=>{
            service.selectCard(card)
            await card.delete().wait()

            expect(service.unselect).toHaveBeenCalled()
            expect(service.emitLists).toHaveBeenCalledWith('updated')
            expect(list.remove).toHaveBeenCalledWith(card)
            expect(c.getRepo().delete).toHaveBeenCalledWith(workout)
        })


        test('already deleting',async ()=>{
            const observer= card.delete()
            observer.emit = jest.fn()

            const observer1= card.delete()

            expect(observer1).toBe(observer)

            await observer.wait()
            expect(observer.emit).toHaveBeenCalledTimes(2)
            expect(observer.emit).toHaveBeenNthCalledWith(1,'started')
            expect(observer.emit).toHaveBeenNthCalledWith(2,'done',true)

        })

        test('error deleting',async ()=>{
            c.getRepo = jest.fn().mockReturnValue({
                delete: jest.fn().mockRejectedValue(new Error())
            })
            
            const observer= card.delete()
            observer.emit = jest.fn()
            const deleted = await observer.wait()
            
            expect(deleted).toBe(false)
            expect(observer.emit).toHaveBeenCalledWith('done',false)
            expect(c.logError).not.toHaveBeenCalled()
            expect(service.emitLists).not.toHaveBeenCalledWith('updated')

        })

        test('unexpected error',async ()=>{
            s.unselectCard = jest.fn( ()=>{ throw new Error()})
            const observer= card.delete()
            
            expect(observer).toBeUndefined()
            expect(c.logError).toHaveBeenCalled()
            

        })
    })


    describe('update',()=>{
        let c,card:WorkoutCard

        beforeEach( ()=>{
            const workout = new Workout({type:'workout',name:'Test',duration:3540})
            c =card = new WorkoutCard(workout)
            c.save = jest.fn()
            c.emitUpdate = jest.fn()
            c.logError = jest.fn()
        })

        test('updating',()=>{
            const wo = new Workout({type:'workout',name:'Test2',duration:3540})
            card.update(wo)

            expect(card.getData()).toBe(wo)
            expect(c.save).toHaveBeenCalled()
            expect(c.emitUpdate).toHaveBeenCalled()

        })

        test('error',()=>{
            c.emitUpdate = jest.fn( ()=>{throw new Error()})

            const wo = new Workout({type:'workout',name:'Test2',duration:3540})
            card.update(wo)

            expect(c.logError).toHaveBeenCalled()

        })

    })

    describe('setVisible',()=>{
        let c,card:WorkoutCard

        beforeEach( ()=>{
            const workout = new Workout({type:'workout',name:'Test',duration:3540})
            c =card = new WorkoutCard(workout)
            c.emitUpdate = jest.fn()
            c.logError = jest.fn()
        })

        test('value changes',()=>{
            c.visible = false
            card.setVisible(true)
            expect(c.emitUpdate).toHaveBeenCalled()
            expect(c.visible).toBe(true)

            c.visible = true
            card.setVisible(false)
            expect(c.emitUpdate).toHaveBeenCalled()
            expect(c.visible).toBe(false)

        })

        test('value does not change',()=>{
            c.visible = false
            card.setVisible(false)
            expect(c.emitUpdate).not.toHaveBeenCalled()
            expect(c.visible).toBe(false)

            c.visible = true
            card.setVisible(true)
            expect(c.emitUpdate).not.toHaveBeenCalled()
            expect(c.visible).toBe(true)
        })

        test('error',()=>{
            c.emitUpdate = jest.fn( ()=>{throw new Error()})
            c.visible = false
            card.setVisible(true)
            expect(c.logError).toHaveBeenCalled()
        })

    })


    describe('calculateDuration',()=>{

        class T extends WorkoutCard {
            public calculateDuration(): string {
                return super.calculateDuration()
            }
        }
        

        test('above 120s with seconds',()=> {
            const workout = new Workout({type:'workout',name:'Test',duration:3570})
            workout.duration = 3570
            const card = new T(workout)
            const res = card.calculateDuration()
            expect(res).toBe('59:30')
    
        })

        test('above 120s without seconds',()=> {
            const workout = new Workout({type:'workout',name:'Test',duration:3540})
            workout.duration = 3540
            const card = new T(workout)
            const res = card.calculateDuration()
            expect(res).toBe('59min')
    
        })

        test('below 120s',()=> {
            const workout = new Workout({type:'workout',name:'Test',duration:119})
            workout.duration = 119
            const card = new T(workout)
            const res = card.calculateDuration()
            expect(res).toBe('119s')
   
        })
  
        test('above 1h with seconds',()=> {
            const workout = new Workout({type:'workout',name:'Test',duration:7215})
            workout.duration = 7215
            const card = new T(workout)
            const res = card.calculateDuration()
            expect(res).toBe('2:00:15')
    
        })

        test('above 1h with less than 10 seconds',()=> {
            const workout = new Workout({type:'workout',name:'Test',duration:7203})
            workout.duration = 7203
            const card = new T(workout)
            const res = card.calculateDuration()
            expect(res).toBe('2:00:03')
    
        })

    })
})