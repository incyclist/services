import { Workout } from '../../base/model'
import {WorkoutCard} from './WorkoutCard'

describe('WorkoutCard',()=>{


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
        
        test('above 1h with seconds',()=> {
            const workout = new Workout({type:'workout',name:'Test',duration:7215})
            workout.duration = 7215
            const card = new T(workout)
            const res = card.calculateDuration()
            expect(res).toBe('2:00:15')
    
        })

    })
})