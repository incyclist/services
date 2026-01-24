

//import routesData from '../../../../__tests__/data/db/routes.json';
import repoData from '../../../../__tests__/data/workouts/db.json'


import { JsonRepository } from '../../../api';
import { WorkoutsDbLoader } from './db';
import { Workout, WorkoutDefinition } from '../../base/model';
import { Observer } from '../../../base/types/observer';
import { waitNextTick } from '../../../utils';
import clone from '../../../utils/clone';
import { JSONObject } from '../../../utils/xml';
import { sleep } from '../../../utils/sleep';

class MockRepository extends JsonRepository {
    static create(repoName:string):JsonRepository {
        return super.create(repoName)
    }
    static reset() {
        JsonRepository._instances = {}
        
    }
}


async function dbTest(loader: WorkoutsDbLoader, workouts: Workout[],id:string) {
    const repo = MockRepository.create('workouts');


    repo['id'] = `${id}`

    repo.read = jest.fn(async (file) => {
        if (file === 'db') {
            const workout = repoData.find(r => r.id === id);
            return [workout] as unknown as JSONObject;
        }
        return null as unknown as JSONObject;
    });

    repo.write = jest.fn();


    
    await new Promise(done => {
        loader.load()
            .on('workout.added', workout => { workouts.push(workout); })
            .on('workout.updated', done)
            .on('done', () => {                 
                setTimeout(done, 100); 
            });           
    });
   
    repo.read = jest.fn()

}






describe('WorkoutDBLoader',()=>{
    describe('load',()=>{

  
        let loader:WorkoutsDbLoader;
        let loaderObj 
        beforeEach( ()=>{
            loader = loaderObj = new WorkoutsDbLoader()                               
        })

        afterEach( ()=>{
            // cleanup Singletons
            loaderObj.reset()            
            MockRepository.reset()
        })


        test('Workout File from DB',async ()=>{
            const workouts:Array<Workout> = []

            const src = repoData.find( w=>w.id==='a1d94b31399d53b0a26d46baa7114884')

            await dbTest(loader, workouts,'a1d94b31399d53b0a26d46baa7114884');            
            expect(workouts.length).toBe(1)

            const wo = workouts[0]
            expect(wo.name).toBe('4. Threshold Under/Overs')
            expect(wo.steps.map(s=>s.type).join(',')).toEqual(src?.steps.map(s=>s.type).join(',')  )
            expect(wo.duration).toBe(49*60)

            loaderObj = {...loader}
            expect(loaderObj['loadObserver'] ).toBeUndefined()

        })

        test('Steps only',async ()=>{
            const workouts:Array<Workout> = []

            const src = repoData.find( w=>w.id==='b5e66d8664c110f67cf5dea67809af00')
            
            await dbTest(loader, workouts,'b5e66d8664c110f67cf5dea67809af00');            
            expect(workouts.length).toBe(1)

            const wo = workouts[0]
            expect(wo.name).toBe('6. FTP Boost')
            expect(wo.steps.map(s=>s.type).join(',')).toEqual(src?.steps.map(s=>s.type).join(',')  )
            expect(wo.duration).toBe(3570)
            expect(wo.getDuration()).toBe(3570)

            loaderObj = {...loader}
            expect(loaderObj['loadObserver'] ).toBeUndefined()

        })

        test('already loading',async ()=>{
            const workouts:Array<Workout> = []
            const observer = new Observer()
            loader['loadObserver'] = observer
            setTimeout( ()=>{ observer.emit('done')},100)

            await dbTest(loader, workouts,'b5e66d8664c110f67cf5dea67809af00');            

            expect(workouts.length).toBe(0)
        })



    })

    describe('stopLoad',()=>{

        let loader:WorkoutsDbLoader;
        let l 
        beforeEach( ()=>{
            loader = l = new WorkoutsDbLoader()                               
        })

        afterEach( ()=>{
            // cleanup Singletons
            l.reset()            
        })



        test('normal',async ()=>{
            const observer = new Observer()
            observer.emit = jest.fn()
            l.loadObserver = observer

            loader.stopLoad()
            expect( observer.emit).toHaveBeenCalledWith('done')

            await waitNextTick()
            expect(l.loadObserver).toBeUndefined()
        })

        test('not loading',()=>{
            loader.stopLoad()
            expect(l.loadObserver).toBeUndefined()
        })
    })


    describe('save',()=>{

        let repo,data
        let l, loader
        beforeEach( ()=>{
            repo = MockRepository.create('workouts');
            repo.write = jest.fn()
            l = loader = new WorkoutsDbLoader()
            data = clone(repoData)
            l.workouts = data.map( m=> new Workout(m as WorkoutDefinition))
        })
        afterEach( ()=>{
            // cleanup Singletons
            l.reset()            
            jest.useRealTimers()
        })


        test('udpate existing workout',async ()=>{
            const wo = data.find(w=>w.id==='76fbf8d1437df646fd148e5f163540a9')
            const workout = new Workout( wo as WorkoutDefinition)
            const cnt = l.workouts.length

            workout.name = 'TEST'
            await loader.save(workout)

            expect( l.workouts.find(w=>w.id==='76fbf8d1437df646fd148e5f163540a9')?.name).toBe('TEST')
            expect( l.workouts.length).toEqual(cnt)
            expect( repo.write).toHaveBeenCalledWith( 'db',l.workouts)

            await sleep(100)
            expect(l.saveObserver).toBeUndefined()
            
        })

        test('add new workout',async ()=>{
            
            const workout = new Workout( { type:'workout', id:'test', steps:[], name:'TEST1'})
            const cnt = l.workouts.length

            await loader.save(workout)

            expect( l.workouts.find(w=>w.id==='test')?.name).toBe('TEST1')
            expect( l.workouts.length).toEqual(cnt+1)
            expect( repo.write).toHaveBeenCalledWith( 'db',l.workouts)

        })
        test('no change to previous',async ()=>{
            const wo = {...data.find(w=>w.id==='76fbf8d1437df646fd148e5f163540a9')}
            const workout = new Workout( wo as WorkoutDefinition)
            const cnt = l.workouts.length

            await loader.save(workout)

            expect( l.workouts.length).toEqual(cnt)
            expect( repo.write).not.toHaveBeenCalled()

        })

        test('error while saving',async ()=>{
            repo.write = jest.fn().mockRejectedValue( new Error('Err'))
            l.logger.logEvent = jest.fn()
            const workout = new Workout( { type:'workout', id:'test', steps:[], name:'TEST1'})
            await loader.save(workout)

            expect(repo.write).toHaveBeenCalled()
            await sleep(100)
            expect(l.logger.logEvent).toHaveBeenCalledWith( expect.objectContaining({message:'could not safe repo'}))
        })


        test('concurrent save requests',async ()=>{
            //jest.useFakeTimers()

            const workout1 = new Workout( { type:'workout', id:'test1', steps:[], name:'TEST1'})
            const workout2 = new Workout( { type:'workout', id:'test2', steps:[], name:'TEST2'})
            const cnt = l.workouts.length

            loader.save(workout1)
            await loader.save(workout2)

            expect( l.workouts.find(w=>w.id==='test1')?.name).toBe('TEST1')
            expect( l.workouts.find(w=>w.id==='test2')?.name).toBe('TEST2')
            expect( l.workouts.length).toEqual(cnt+2)
            expect( repo.write).toHaveBeenCalledTimes(1)

            /*
            jest.advanceTimersByTime(900)
            expect( repo.write).toHaveBeenCalledTimes(1)

            jest.advanceTimersByTime(101)
            expect( repo.write).toHaveBeenCalledTimes(2)
            */

        })

    })

    describe('delete',()=>{
        let repo,data
        let l, loader
        beforeEach( ()=>{
            repo = MockRepository.create('workouts');
            repo.write = jest.fn()
            l = loader = new WorkoutsDbLoader()
            data = clone(repoData)
            l.workouts = data.map( m=> new Workout(m as WorkoutDefinition))
        })
        afterEach( ()=>{
            // cleanup Singletons
            l.reset()            
            jest.useRealTimers()
        })

        test('delete existing workout',async ()=>{
            const wo = data.find(w=>w.id==='76fbf8d1437df646fd148e5f163540a9')
            const workout = new Workout( wo as WorkoutDefinition)
            const cnt = l.workouts.length

            await loader.delete(workout)

            expect( l.workouts.find(w=>w.id==='76fbf8d1437df646fd148e5f163540a9')).toBeUndefined()
            expect( l.workouts.length).toEqual(cnt-1)
            expect( repo.write).toHaveBeenCalledWith( 'db',l.workouts)

            await sleep(100)
            expect(l.saveObserver).toBeUndefined()
            
        })

        test('delete non existing  workout',async ()=>{
            
            const workout = new Workout( { type:'workout', id:'test', steps:[], name:'TEST1'})
            await expect( async()=> {await loader.delete(workout)}).rejects.toThrow('workout not found')

        })

    })

})
