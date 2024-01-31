import { Workout } from '../../base/model'
import {WorkoutCard} from './WorkoutCard'

describe('WorkoutCard',()=>{


    describe('calculateDuration',()=>{

        class T extends WorkoutCard {
            public calculateDuration(): string {
                return super.calculateDuration()
            }
        }
        const workout = new Workout({type:'workout',name:'Test',duration:3570})

        test('above 120s with seconds',()=> {
            workout.duration = 3570
            const card = new T(workout)
            const res = card.calculateDuration()
            expect(res).toBe('59:30')
    
        })
        
    })
})