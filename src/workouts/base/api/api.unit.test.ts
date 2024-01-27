import  {IncyclistWorkoutsApi}  from './index'

const BASE_URL = process.env.WORKOUT_API || "http://localhost:3004/api/v1/workouts"

class Api extends IncyclistWorkoutsApi {
    
    getBaseUrl():string {
        return super.getBaseUrl()
    }
}

/*
    This is only used for manual testing
*/

describe.skip('WorkoutsApi',()=>{
    let wo
    beforeAll( ()=>{
        wo = new Api()
        wo.getBaseUrl = jest.fn().mockReturnValue(BASE_URL)

    })

    describe('get all workouts',()=>{

        test('success',async ()=>{
    
            const workouts = await wo.getWorkouts()
            console.log(workouts)
        })
    
    
    })


    describe('get single workout',()=>{

        test('success',async ()=>{
   
            const workout = await wo.getWorkout('1')
            console.log(workout)
        })
    
    
    })

})