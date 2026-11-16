import { EventEmitter } from 'node:events'
import { Inject } from '../../base/decorators'
import { AppStateService } from '../../appstate'
import { WorkoutCalendarService } from '../calendar'
import { ScheduledWorkoutPromptPageService } from './service'

const SCHEDULED = {
    id: 'intervals:cal-entry-99', // composite calendar entry id - must never be used
    name: 'VO2 Max Intervals',
    type: 'scheduled',
    workoutId: 'workout-42',
    workout: { id: 'workout-42', name: 'VO2 Max Intervals' },
}

class FakeCalendar extends EventEmitter {
    getScheduledToday = jest.fn()
}

describe('ScheduledWorkoutPromptPageService', () => {
    let service: ScheduledWorkoutPromptPageService
    let calendar: FakeCalendar
    let store: Record<string, unknown>
    let logSpy: jest.SpyInstance

    const appState: Partial<AppStateService> = {
        getState: jest.fn((key: string) => store[key]),
        setState: jest.fn((key: string, value: unknown) => { store[key] = value }),
    }

    beforeEach(() => {
        store = {}
        calendar = new FakeCalendar()
        Inject('AppState', appState)
        Inject('WorkoutCalendar', calendar as unknown as Partial<WorkoutCalendarService>)
        service = new ScheduledWorkoutPromptPageService()
        logSpy = jest.spyOn(service as any, 'logEvent').mockImplementation(() => undefined)
    })

    afterEach(() => {
        (service as any).reset()
        Inject('AppState', null)
        Inject('WorkoutCalendar', null)
        jest.clearAllMocks()
    })

    describe('show', () => {
        test('returns null when no workout is scheduled today', () => {
            calendar.getScheduledToday.mockReturnValue(undefined)
            expect(service.show()).toBeNull()
            expect(appState.setState).not.toHaveBeenCalled()
        })

        test('returns title and workoutId when a workout is scheduled', () => {
            calendar.getScheduledToday.mockReturnValue(SCHEDULED)
            expect(service.show()).toEqual({ title: 'VO2 Max Intervals', workoutId: 'workout-42' })
        })

        test('sets the once-per-session guard and logs when shown', () => {
            calendar.getScheduledToday.mockReturnValue(SCHEDULED)
            service.show()
            expect(appState.setState).toHaveBeenCalledWith('scheduledPromptShown', true)
            expect(logSpy).toHaveBeenCalledWith({ message: 'scheduled workout prompt shown', workoutId: 'workout-42' })
        })

        test('returns null when the guard is already set', () => {
            store.scheduledPromptShown = true
            calendar.getScheduledToday.mockReturnValue(SCHEDULED)
            expect(service.show()).toBeNull()
            expect(appState.setState).not.toHaveBeenCalled()
        })

        test('uses the workout content id, never the composite calendar id', () => {
            calendar.getScheduledToday.mockReturnValue(SCHEDULED)
            const res = service.show()
            expect(res?.workoutId).toBe('workout-42')
            expect(res?.workoutId).not.toBe('intervals:cal-entry-99')
        })

        test('falls back to workoutId if the workout is not resolved', () => {
            calendar.getScheduledToday.mockReturnValue({ ...SCHEDULED, workout: undefined })
            expect(service.show()?.workoutId).toBe('workout-42')
        })

        test('returns null if no workout id can be resolved', () => {
            calendar.getScheduledToday.mockReturnValue({ ...SCHEDULED, workout: undefined, workoutId: undefined })
            expect(service.show()).toBeNull()
        })

        test('first call wins, second returns null', () => {
            calendar.getScheduledToday.mockReturnValue(SCHEDULED)
            expect(service.show()).not.toBeNull()
            expect(service.show()).toBeNull()
        })

        test('returns null and does not throw on errors', () => {
            calendar.getScheduledToday.mockImplementation(() => { throw new Error('boom') })
            expect(service.show()).toBeNull()
        })
    })

    describe('isPending', () => {
        test('true without side effects when a workout is scheduled and guard is unset', () => {
            calendar.getScheduledToday.mockReturnValue(SCHEDULED)
            expect(service.isPending()).toBe(true)
            expect(appState.setState).not.toHaveBeenCalled()
        })

        test('false when the guard is set', () => {
            store.scheduledPromptShown = true
            calendar.getScheduledToday.mockReturnValue(SCHEDULED)
            expect(service.isPending()).toBe(false)
        })

        test('false when nothing is scheduled', () => {
            calendar.getScheduledToday.mockReturnValue(undefined)
            expect(service.isPending()).toBe(false)
        })
    })

    describe('scheduled relay', () => {
        test('re-emits the calendar scheduled event', () => {
            const cb = jest.fn()
            service.on('scheduled', cb)
            calendar.emit('scheduled', SCHEDULED)
            expect(cb).toHaveBeenCalledWith(SCHEDULED)
        })

        test('stops relaying after reset', () => {
            const cb = jest.fn()
            service.on('scheduled', cb)
            ;(service as any).reset()
            calendar.emit('scheduled', SCHEDULED)
            expect(cb).not.toHaveBeenCalled()
        })
    })

    describe('answers', () => {
        const prompt = { title: 'VO2 Max Intervals', workoutId: 'workout-42' }

        test('onYes returns navigation with autoOpenDetailsId and logs', () => {
            expect(service.onYes(prompt)).toEqual({ page: 'workouts', autoOpenDetailsId: 'workout-42' })
            expect(logSpy).toHaveBeenCalledWith({ message: 'scheduled workout prompt answered', workoutId: 'workout-42', answer: 'yes' })
        })

        test('onNo only logs', () => {
            expect(service.onNo(prompt)).toBeUndefined()
            expect(logSpy).toHaveBeenCalledWith({ message: 'scheduled workout prompt answered', workoutId: 'workout-42', answer: 'no' })
        })

        test('onCheckWorkouts returns navigation without id and logs', () => {
            expect(service.onCheckWorkouts(prompt)).toEqual({ page: 'workouts' })
            expect(logSpy).toHaveBeenCalledWith({ message: 'scheduled workout prompt answered', workoutId: 'workout-42', answer: 'check' })
        })
    })
})
