// the apps module has to be loaded first (it registers the uploaders/providers and depends on the factories)
import '../../../../apps'
import { TrainerDayAppConnection } from '../../../../apps'
import { TrainerDayApi, TrainerDayCalendarWorkout } from '../../../../apps/base/api/trainerday'
import { Inject } from '../../../../base/decorators'
import { sleep } from '../../../../utils/sleep'
import { WorkoutCalendarEntry } from '../../types'
import { TrainerDayCalendarSyncProvider } from './provider'
import real from '../../../../../__tests__/data/workouts/trainerday-calendar-real.json'

type SyncResult = {
    event: string
    workouts: Array<WorkoutCalendarEntry>
    changes: Array<[string, WorkoutCalendarEntry]>
}

const tdWorkout = (id: string, props: Partial<TrainerDayCalendarWorkout> = {}): TrainerDayCalendarWorkout => ({
    eventId: id,
    workoutId: -123,
    date: '2026-11-20',
    title: `Workout ${id}`,
    workoutType: 'bike',
    intensityMetric: 'percentOfFtp',
    workoutBlocks: [
        { type: 'segment', reps: null, segments: [{ durationType: 'second', durationValue: 600, targets: [{ type: 'primary', min: 50, max: null }] }] },
        {
            type: 'repetition', reps: 3, segments: [
                { durationType: 'second', durationValue: 240, targets: [{ type: 'primary', min: 110, max: null }] },
                { durationType: 'second', durationValue: 120, segmentType: 'rest', targets: [{ type: 'primary', min: 50, max: null }] }
            ]
        }
    ],
    ...props
})

describe('TrainerDayCalendarSyncProvider', () => {

    let service: TrainerDayCalendarSyncProvider
    let api: { getCalendar: jest.Mock }
    let connected: boolean
    let enabled: boolean

    beforeEach(() => {
        connected = true
        enabled = true
        api = { getCalendar: jest.fn().mockResolvedValue([]) }

        const connection: Partial<TrainerDayAppConnection> = {
            isConnected: jest.fn(() => connected),
            getApi: jest.fn().mockReturnValue(api as unknown as TrainerDayApi)
        }
        Inject('TrainerDayAppConnection', connection)
        Inject('AppsService', { isEnabled: jest.fn(() => enabled) })

        service = new TrainerDayCalendarSyncProvider()
    })

    afterEach(() => {
        Inject('TrainerDayAppConnection', null)
        Inject('AppsService', null)
        service.reset()
        jest.clearAllMocks()
    })

    /** performs one sync and collects the result (resolves with the first `loaded` / `done` event) */
    const syncOnce = async (): Promise<SyncResult> => {
        const result = await new Promise<SyncResult>(resolve => {
            const observer = service.sync()
            const changes: Array<[string, WorkoutCalendarEntry]> = []

            for (const change of ['added', 'updated', 'deleted']) {
                observer.on(change, (w: WorkoutCalendarEntry) => { changes.push([change, w]) })
            }
            observer.once('loaded', (workouts: Array<WorkoutCalendarEntry>) => resolve({ event: 'loaded', workouts: [...workouts], changes }))
            observer.once('done', (workouts: Array<WorkoutCalendarEntry>) => resolve({ event: 'done', workouts: [...workouts], changes }))
        })
        // let the provider clean up the observer before the next sync
        await sleep(5)
        return result
    }

    const summary = (changes: Array<[string, WorkoutCalendarEntry]>) => changes.map(([type, w]) => [type, w.workoutId])

    describe('isConnected', () => {
        test('reflects the connection', () => {
            expect(service.isConnected()).toBe(true)
            connected = false
            expect(service.isConnected()).toBe(false)
        })

        test('false if the connection cannot be determined', () => {
            Inject('TrainerDayAppConnection', { isConnected: () => { throw new Error('ERROR') } })
            expect(service.isConnected()).toBe(false)
        })
    })

    describe('first sync', () => {
        test('converts the workouts and emits `loaded`', async () => {
            api.getCalendar.mockResolvedValue([tdWorkout('a'), tdWorkout('b', { date: '2026-11-22', title: 'Second' })])

            const { event, workouts, changes } = await syncOnce()

            expect(event).toBe('loaded')
            expect(changes).toEqual([])
            expect(workouts).toHaveLength(2)
            expect(workouts[0].workoutId).toBe('a')
            expect(workouts[0].source).toBe('trainerday')
            expect(workouts[0].day).toEqual(new Date('2026-11-20T00:00:00'))
            expect(workouts[0].workout?.duration).toBe(600 + 3 * 360)
            expect(workouts[0].updated).toBeInstanceOf(Date)
            expect(Number.isNaN(workouts[0].updated.valueOf())).toBe(false)
            expect(workouts[1].workoutId).toBe('b')
            expect(workouts[1].workout?.name).toBe('Second')
            expect(workouts[1].day).toEqual(new Date('2026-11-22T00:00:00'))
        })

        test('requests the 28 days following the first day of the current week', async () => {
            await syncOnce()

            const [start, end] = api.getCalendar.mock.calls[0] as [Date, Date]
            expect(start.getDay()).toBe(1) // Monday
            expect(Math.round((end.valueOf() - start.valueOf()) / 86400000)).toBe(28)
        })

        test('ignores everything but cycling workouts', async () => {
            api.getCalendar.mockResolvedValue([
                tdWorkout('1'),
                tdWorkout('2', { workoutType: 'swim' }),
                tdWorkout('3', { workoutType: 'run' }),
                tdWorkout('4', { workoutType: 'rowing' }),
                tdWorkout('5', { workoutType: undefined }),
            ])

            const { workouts } = await syncOnce()

            expect(workouts.map(w => w.workoutId)).toEqual(['1'])
        })

        test('skips workouts that cannot be converted and logs them, the others are still loaded', async () => {
            const logSpy = jest.fn()
            service.on('log', logSpy)
            api.getCalendar.mockResolvedValue([
                tdWorkout('1'),
                tdWorkout('2', { intensityMetric: 'percentOfHr' }),
                tdWorkout('3', { workoutBlocks: [{ type: 'segment', segments: [{ durationType: 'meter', durationValue: 1000, targets: [{ type: 'primary', min: 60 }] }] }] }),
                tdWorkout('4', { workoutBlocks: [] }),
                tdWorkout('5'),
            ])

            const { event, workouts } = await syncOnce()

            expect(event).toBe('loaded')
            expect(workouts.map(w => w.workoutId)).toEqual(['1', '5'])
            expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ message: 'workout skipped', workout: 'Workout 3', reason: expect.stringContaining('meter') }))
        })

        test('skips workouts without eventId', async () => {
            api.getCalendar.mockResolvedValue([tdWorkout('1', { eventId: undefined }), tdWorkout('2')])

            const { workouts } = await syncOnce()

            expect(workouts.map(w => w.workoutId)).toEqual(['2'])
        })

        test('invalid or missing day falls back to today', async () => {
            api.getCalendar.mockResolvedValue([tdWorkout('1', { date: undefined }), tdWorkout('2', { date: 'foo' })])

            const { workouts } = await syncOnce()

            expect(workouts).toHaveLength(2)
            workouts.forEach(w => { expect(Number.isNaN(w.day.valueOf())).toBe(false) })
        })

        test('no workouts in the calendar', async () => {
            const { event, workouts } = await syncOnce()

            expect(event).toBe('loaded')
            expect(workouts).toEqual([])
        })

        test('null response is handled like an empty calendar', async () => {
            api.getCalendar.mockResolvedValue(null)

            const { workouts } = await syncOnce()

            expect(workouts).toEqual([])
        })

        test('the number of workouts is logged', async () => {
            const logSpy = jest.fn()
            service.on('log', logSpy)
            api.getCalendar.mockResolvedValue([tdWorkout('1'), tdWorkout('2', { workoutType: 'run' })])

            await syncOnce()

            expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ message: 'workout sync', cntTotal: 2, cntCycling: 1 }))
        })

        test('real workouts of the calendar', async () => {
            api.getCalendar.mockResolvedValue(real)

            const { workouts } = await syncOnce()

            expect(workouts).toHaveLength(real.length)
            expect(new Set(workouts.map(w => w.workoutId)).size).toBe(real.length)
        })
    })

    describe('not able to sync', () => {
        test('not connected: nothing is requested', async () => {
            connected = false

            const { event, workouts } = await syncOnce()

            expect(event).toBe('loaded')
            expect(workouts).toEqual([])
            expect(api.getCalendar).not.toHaveBeenCalled()
        })

        test('connection missing (throws): nothing is requested', async () => {
            Inject('TrainerDayAppConnection', { isConnected: () => { throw new Error('no connection') } })

            const { event, workouts } = await syncOnce()

            expect(event).toBe('loaded')
            expect(workouts).toEqual([])
        })

        test('workout download not enabled: nothing is requested', async () => {
            enabled = false

            const { event, workouts } = await syncOnce()

            expect(event).toBe('loaded')
            expect(workouts).toEqual([])
            expect(api.getCalendar).not.toHaveBeenCalled()
        })

        test('request fails: emits `loaded` without workouts and the next sync is again a first sync', async () => {
            api.getCalendar.mockRejectedValueOnce(new Error('token refresh failed'))
            api.getCalendar.mockResolvedValueOnce([tdWorkout('1')])

            const first = await syncOnce()
            expect(first.event).toBe('loaded')
            expect(first.workouts).toEqual([])

            const second = await syncOnce()
            expect(second.event).toBe('loaded')
            expect(second.workouts.map(w => w.workoutId)).toEqual(['1'])
        })
    })

    describe('follow-up syncs', () => {
        beforeEach(async () => {
            api.getCalendar.mockResolvedValue([tdWorkout('1'), tdWorkout('2')])
            await syncOnce()
        })

        test('unchanged workouts are not reported (the hash is stable)', async () => {
            // a new object with equal content
            api.getCalendar.mockResolvedValue([tdWorkout('1'), tdWorkout('2')])

            const { event, workouts, changes } = await syncOnce()

            expect(event).toBe('done')
            expect(changes).toEqual([])
            expect(workouts.map(w => w.workoutId)).toEqual(['1', '2'])
        })

        test('a new workout is reported as added', async () => {
            api.getCalendar.mockResolvedValue([tdWorkout('1'), tdWorkout('2'), tdWorkout('3')])

            const { event, workouts, changes } = await syncOnce()

            expect(event).toBe('done')
            expect(summary(changes)).toEqual([['added', '3']])
            expect(workouts.map(w => w.workoutId)).toEqual(['1', '2', '3'])
        })

        test.each([
            ['title', { title: 'Renamed' }],
            ['description', { description: 'new description' }],
            ['structure', { workoutBlocks: [{ type: 'segment' as const, segments: [{ durationValue: 900, targets: [{ type: 'primary' as const, min: 70 }] }] }] }],
        ])('a modified %s is reported as updated', async (_name, props) => {
            api.getCalendar.mockResolvedValue([tdWorkout('1'), tdWorkout('2', props)])

            const { workouts, changes } = await syncOnce()

            expect(summary(changes)).toEqual([['updated', '2']])
            expect(workouts).toHaveLength(2)
        })

        test('a workout moved to another day is reported as updated', async () => {
            api.getCalendar.mockResolvedValue([tdWorkout('1'), tdWorkout('2', { date: '2026-11-25' })])

            const { workouts, changes } = await syncOnce()

            expect(summary(changes)).toEqual([['updated', '2']])
            expect(workouts[1].day).toEqual(new Date('2026-11-25T00:00:00'))
        })

        test('a workout that is no longer in the calendar is reported as deleted', async () => {
            api.getCalendar.mockResolvedValue([tdWorkout('2')])

            const { workouts, changes } = await syncOnce()

            expect(summary(changes)).toEqual([['deleted', '1']])
            expect(workouts.map(w => w.workoutId)).toEqual(['2'])
        })

        test('a workout that was changed to a type other than cycling is reported as deleted', async () => {
            api.getCalendar.mockResolvedValue([tdWorkout('1', { workoutType: 'run' }), tdWorkout('2')])

            const { changes } = await syncOnce()

            expect(summary(changes)).toEqual([['deleted', '1']])
        })

        test('a workout that can no longer be converted is reported as deleted', async () => {
            api.getCalendar.mockResolvedValue([tdWorkout('1', { intensityMetric: 'percentOfHr' }), tdWorkout('2')])

            const { changes } = await syncOnce()

            expect(summary(changes)).toEqual([['deleted', '1']])
        })

        test('request fails: emits `done` and keeps the known workouts', async () => {
            api.getCalendar.mockRejectedValueOnce(new Error('ECONNRESET'))

            const failed = await syncOnce()
            expect(failed.event).toBe('done')
            expect(failed.workouts).toEqual([])

            const next = await syncOnce()
            expect(next.workouts.map(w => w.workoutId)).toEqual(['1', '2'])
            expect(next.changes).toEqual([])
        })

        test('reset: the next sync is a first sync again', async () => {
            service.reset()

            const { event, workouts, changes } = await syncOnce()

            expect(event).toBe('loaded')
            expect(changes).toEqual([])
            expect(workouts).toHaveLength(2)
        })
    })

    describe('sync', () => {
        test('a sync that is already running is not started a second time', async () => {
            api.getCalendar.mockResolvedValue([tdWorkout('1')])

            const first = service.sync()
            const second = service.sync()

            expect(second).toBe(first)
            await new Promise<void>(resolve => { first.once('loaded', () => resolve()) })
            expect(api.getCalendar).toHaveBeenCalledTimes(1)
        })

        test('a stop request ends the sync without workouts', async () => {
            api.getCalendar.mockResolvedValue([tdWorkout('1'), tdWorkout('2'), tdWorkout('3')])

            const workouts = await new Promise<Array<WorkoutCalendarEntry>>(resolve => {
                const observer = service.sync()
                observer.once('loaded', (w: Array<WorkoutCalendarEntry>) => resolve(w))
                observer.emit('stop')
            })

            expect(workouts).toEqual([])
        })

        test('the stop flag is cleared after the sync, the next sync works normally', async () => {
            api.getCalendar.mockResolvedValue([tdWorkout('1')])

            await new Promise<void>(resolve => {
                const observer = service.sync()
                observer.once('loaded', () => resolve())
                observer.emit('stop')
            })
            await sleep(5)

            const { event, workouts } = await syncOnce()
            expect(event).toBe('loaded')
            expect(workouts.map(w => w.workoutId)).toEqual(['1'])
        })
    })
})
