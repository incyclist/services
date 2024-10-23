import {IncyclistWorkoutsApi} from '../../base/api'
import { Plan, Workout } from '../../base/model/Workout'
import {WorkoutsApiLoader} from './api'


const testData = [
    { id:'1',type:'workout', name:'1', steps:[ ], repeat:1},
    { id:'2',type:'workout', name:'2', steps:[ ], repeat:1},
    { id:'3',type:'plan', name:'plan', workouts:[ 
        {week:1, day:1, workout:'1'},
        {week:2, day:1, workout:'1'}
    ]},
]

describe('WorkoutsApiLoader',()=>{

    describe('load',()=>{


        test('e2e test - should only be executed manually',async ()=>{

            const api = new IncyclistWorkoutsApi()
            api.getWorkouts = jest.fn().mockResolvedValue(testData)
           
            
            const loader = new WorkoutsApiLoader()
            const observer = loader.load()
            const workouts:Array<Workout|Plan> = []

            const load = () => new Promise (  (done)=> {
                observer.on( 'workout.added', workout=>{
                    workouts.push(workout)                
                })
                observer.on( 'workout.updated', workout=>{
                    console.log('updated ',workout.id, workout.name, workout.hash)
                })

                observer.on( 'done', done)
            })

            await load()
            expect(workouts.length).toBe(3)
            
        },6000)
    })

})