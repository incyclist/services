import { FileInfo } from '../../../api'
import { CardList } from '../../../base/cardlist';
import { Observer } from '../../../base/types/observer'
import { ActiveImportCard } from './ActiveImportCard'


describe('ActiveImportCard',()=>{

    let c;
    const info:FileInfo = {filename:'./test.zwo',name:'test.zwo',dir:'.',ext:'zwo',delimiter:'/',type:'file'}

    test('constructor and getters',()=>{


        const card = new ActiveImportCard(info)

        expect(card.getId()).toBe('./test.zwo')
        expect(card.getData()).toBeUndefined()
        expect(card.getTitle()).toBe('Import Workout')
        expect(card.getCardType()).toBe('ActiveWorkoutImport')
        expect(card.isVisible()).toBe(true)
        expect(card.canDelete()).toBe(true)
        expect(card.canStart({isOnline:true})).toBe(false)
        expect(card.canStart({isOnline:false})).toBe(false)
        expect(card.getDisplayProperties()).toMatchObject( {name:'test.zwo', error:null,observer:expect.any(Observer),visible:true})

    })

    test('delete',async ()=>{
        const card = new ActiveImportCard(info)
        c = card

        const myWorkouts = new CardList('myWorkouts', 'My Workouts')
        myWorkouts.remove = jest.fn()

        c.getWorkoutList = jest.fn().mockReturnValue( {
            getLists: () => [ myWorkouts],
            emitLists: jest.fn()
        })

        const observer = card.delete()
        observer.emit = jest.fn()
        const deleted = await observer.wait()


        expect(deleted).toBe(true)
        expect(myWorkouts.remove).toHaveBeenCalledWith(card)
        expect(c.getWorkoutList().emitLists).toHaveBeenCalledWith('updated')
        expect(observer.emit).not.toHaveBeenCalled()
        

    })

    describe.skip('retry',()=>{
        const card = new ActiveImportCard(info)
        c = card

        const myWorkouts = new CardList('myWorkouts', 'My Workouts')
        myWorkouts.remove = jest.fn()

        c.getWorkoutList = jest.fn().mockReturnValue( {
            import:jest.fn()
        })
        c.cardObserver.emit = jest.fn()

        card.retry()
        
        expect(c.cardObserver.emit).toHaveBeenCalledWith('update',expect.objectContaining({error:null}))
        expect(c.getWorkoutList().import).toHaveBeenCalledWith(info,{card})

    })

    test('setError',()=>{
        const card = new ActiveImportCard(info)
        c = card
        c.cardObserver.emit = jest.fn()

        const error = new Error('some error')
        c.setError( error)

        expect(c.cardObserver.emit).toHaveBeenCalledWith('update',expect.objectContaining({error}))
        expect(c.error).toBe(error)
    
    })

})