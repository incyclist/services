

//import routesData from '../../../../__tests__/data/db/routes.json';
import repoData from '../../../../__tests__/data/workouts/db.json'


import { JSONObject, JsonRepository } from '../../../api';
import { WorkoutsDbLoader } from './db';
import { Workout } from '../../base/model';

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

    console.log('done - observer:',loader['loadObserver'])
    
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



    })

})
