import { before } from 'node:test';
import {getFirstDayOfCurrentWeek} from './time'

describe('getFirstDayOfCurrentWeek', () => {

    const formatDay = (day:Date) => day.getUTCDate() + '.' + (day.getMonth()+1) + '.' + day.getFullYear()  

    beforeAll( () => {
        jest.useFakeTimers();
    })
    afterAll( () => {
        jest.useRealTimers();
    })
    
    test('Monday',()=>{
        jest.useFakeTimers().setSystemTime(new Date('2025-08-04T17:00:00Z')); // Set to a Monday
        const firstDay = getFirstDayOfCurrentWeek();   
        expect(firstDay.getDay()).toBe(1); // Check if it's Monday
        expect(formatDay(firstDay)).toBe('4.8.2025');
    })

    test('Tuesday',()=>{
        jest.useFakeTimers().setSystemTime(new Date('2025-08-05T00:00:00Z')); // Set to a Tuesday
        const firstDay = getFirstDayOfCurrentWeek();   
        expect(firstDay.getDay()).toBe(1); // Check if it's Monday
        expect(formatDay(firstDay)).toBe('4.8.2025');

    })

    test('Sunday',()=>{
        jest.useFakeTimers().setSystemTime(new Date('2025-08-10T00:00:00Z')); // Set to a Sunday
        const firstDay = getFirstDayOfCurrentWeek();   
        expect(firstDay.getDay()).toBe(1); // Check if it's Monday
        expect(formatDay(firstDay)).toBe('4.8.2025');

    })

})
