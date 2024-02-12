import { WorkoutImportCard } from "./WorkoutImportCard";
import { DEFAULT_FILTERS } from "./types";

describe('WorkoutImportCard',()=>{

    test('constructor and getters',()=>{


        const card = new WorkoutImportCard()

        expect(card.getId()).toBe('Import')
        expect(card.getData()).toBeUndefined()
        expect(card.getTitle()).toBe('Import Workout')
        expect(card.getCardType()).toBe('WorkoutImport')
        expect(card.isVisible()).toBe(true)
        expect(card.canDelete()).toBe(false)
        expect(card.canStart({isOnline:true})).toBe(false)
        expect(card.canStart({isOnline:false})).toBe(false)
        expect(card.getDisplayProperties()).toMatchObject( {title:'Import Workout',filters:DEFAULT_FILTERS })

    })



})