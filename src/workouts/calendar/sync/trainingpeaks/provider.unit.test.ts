import { loadFile } from '../../../../../__tests__/utils/loadFile'
// the apps module has to be loaded first (it registers the uploaders/providers and depends on the factories)
import '../../../../apps'
import { TrainingPeaksApi, TrainingPeaksAppConnection, TrainingPeaksWorkout } from '../../../../apps'
import { Inject } from '../../../../base/decorators'
import { sleep } from '../../../../utils/sleep'
import { WorkoutCalendarEntry } from '../../types'
import { TrainingPeaksCalendarSyncProvider } from './provider'

type SyncResult = {
    event: string
    workouts: Array<WorkoutCalendarEntry>
    changes: Array<[string, WorkoutCalendarEntry]>
}

const MODIFIED = '2026-11-10T08:00:00'

const tpWorkout = (id: number, props: Partial<TrainingPeaksWorkout> = {}): TrainingPeaksWorkout => ({
    Id: id,
    WorkoutDay: '2026-11-16T00:00:00',
    WorkoutType: 'Bike',
    Title: `Workout ${id}`,
    LastModifiedDate: MODIFIED,
    WorkoutFileFormats: ['erg', 'fit', 'mrc', 'zwo'],
    TotalTimePlanned: 1.5,
    ...props
})

describe('TrainingPeaksCalendarSyncProvider', () => {

    let service: TrainingPeaksCalendarSyncProvider
    let zwo: string
    let zwo2: string
    let api: { getWorkouts: jest.Mock, getWorkoutFile: jest.Mock }
    let connected: boolean
    let enabled: boolean

    beforeAll(async () => {
        zwo = await loadFile('utf-8', './__tests__/data/workouts/Mayfield.zwo') as string
        zwo2 = await loadFile('utf-8', './__tests__/data/workouts/Ramp_Test.zwo') as string
    })

    beforeEach(() => {
        connected = true
        enabled = true
        api = {
            getWorkouts: jest.fn().mockResolvedValue([]),
            getWorkoutFile: jest.fn().mockResolvedValue(zwo)
        }

        const connection: Partial<TrainingPeaksAppConnection> = {
            isConnected: jest.fn(() => connected),
            getApi: jest.fn().mockReturnValue(api as unknown as TrainingPeaksApi)
        }
        Inject('TrainingPeaksAppConnection', connection)
        Inject('AppsService', { isEnabled: jest.fn(() => enabled) })

        service = new TrainingPeaksCalendarSyncProvider()
    })

    afterEach(() => {
        Inject('TrainingPeaksAppConnection', null)
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

    describe('isConnected', () => {
        test('reflects the connection', () => {
            expect(service.isConnected()).toBe(true)
            connected = false
            expect(service.isConnected()).toBe(false)
        })

        test('false if the connection cannot be determined', () => {
            Inject('TrainingPeaksAppConnection', { isConnected: () => { throw new Error('ERROR') } })
            expect(service.isConnected()).toBe(false)
        })
    })

    describe('first sync', () => {
        test('loads the cycling workouts that are available as ZWO and emits `loaded`', async () => {
            api.getWorkouts.mockResolvedValue([tpWorkout(1), tpWorkout(2, { WorkoutDay: '2026-11-18T00:00:00' })])

            const { event, workouts, changes } = await syncOnce()

            expect(event).toBe('loaded')
            expect(changes).toEqual([])
            expect(workouts).toHaveLength(2)
            expect(workouts[0].workoutId).toBe('1')
            expect(workouts[0].day).toEqual(new Date('2026-11-16T00:00:00'))
            expect(workouts[0].updated).toEqual(new Date(MODIFIED))
            expect(workouts[0].workout?.name).toBe('Jon\'s Short Mix')
            expect(workouts[1].workoutId).toBe('2')
            expect(workouts[1].day).toEqual(new Date('2026-11-18T00:00:00'))
            expect(api.getWorkoutFile).toHaveBeenCalledWith(1, 'zwo')
            expect(api.getWorkoutFile).toHaveBeenCalledWith(2, 'zwo')
        })

        test('requests the 30 days following the first day of the current week', async () => {
            await syncOnce()

            const [start, end] = api.getWorkouts.mock.calls[0] as [Date, Date]
            expect(start.getDay()).toBe(1) // Monday
            expect(Math.round((end.valueOf() - start.valueOf()) / 86400000)).toBe(30)
        })

        test('ignores everything but cycling workouts', async () => {
            api.getWorkouts.mockResolvedValue([
                tpWorkout(1, { WorkoutType: 'Bike' }),
                tpWorkout(2, { WorkoutType: 'bike' }),
                tpWorkout(3, { WorkoutType: 'Run' }),
                tpWorkout(4, { WorkoutType: 'Brick' }),
                tpWorkout(5, { WorkoutType: 'Day Off' }),
                tpWorkout(6, { WorkoutType: undefined as unknown as string }),
            ])

            const { workouts } = await syncOnce()

            expect(workouts.map(w => w.workoutId)).toEqual(['1', '2'])
            expect(api.getWorkoutFile).toHaveBeenCalledTimes(2)
        })

        test('skips workouts that are known to have no ZWO file without downloading anything', async () => {
            api.getWorkouts.mockResolvedValue([
                tpWorkout(1, { WorkoutFileFormats: ['fit', 'erg'] }),
                tpWorkout(2, { WorkoutFileFormats: ['mrc'] }),
                tpWorkout(4, { WorkoutFileFormats: ['ZWO'] }),
            ])

            const { workouts } = await syncOnce()

            expect(workouts.map(w => w.workoutId)).toEqual(['4'])
            expect(api.getWorkoutFile).toHaveBeenCalledTimes(1)
        })

        // the list of a date range does not tell the formats (the log of the app showed empty formats for every workout)
        test.each([
            ['no formats', undefined],
            ['empty list of formats', []],
        ])('formats are not provided (%s): the file is requested', async (_name, formats) => {
            api.getWorkouts.mockResolvedValue([tpWorkout(1, { WorkoutFileFormats: formats }), tpWorkout(2, { WorkoutFileFormats: formats })])

            const { event, workouts } = await syncOnce()

            expect(event).toBe('loaded')
            expect(workouts.map(w => w.workoutId)).toEqual(['1', '2'])
            expect(api.getWorkoutFile).toHaveBeenCalledTimes(2)
        })

        test('skips a workout whose file cannot be downloaded or parsed, the others are still loaded', async () => {
            api.getWorkouts.mockResolvedValue([tpWorkout(1), tpWorkout(2), tpWorkout(3)])
            api.getWorkoutFile
                .mockRejectedValueOnce(new Error('HTTP 404'))
                .mockResolvedValueOnce('this is not a workout file')
                .mockResolvedValueOnce(zwo2)

            const { event, workouts } = await syncOnce()

            expect(event).toBe('loaded')
            expect(workouts.map(w => w.workoutId)).toEqual(['3'])
        })

        test('uses the current time as modification time if TrainingPeaks does not provide one', async () => {
            api.getWorkouts.mockResolvedValue([tpWorkout(1, { LastModifiedDate: undefined })])

            const { workouts } = await syncOnce()

            expect(workouts[0].updated).toBeInstanceOf(Date)
            expect(Number.isNaN(workouts[0].updated.valueOf())).toBe(false)
        })

        test('no workouts in the calendar', async () => {
            const { event, workouts } = await syncOnce()

            expect(event).toBe('loaded')
            expect(workouts).toEqual([])
        })
    })

    describe('activities (uploaded rides) are no workouts', () => {
        // TrainingPeaks does not distinguish between workouts and activities: an activity is a completed workout without planned values
        const activity = (id: number, props: Partial<TrainingPeaksWorkout> = {}) => tpWorkout(id, {
            Completed: true, WorkoutFileFormats: undefined,
            TotalTimePlanned: null, DistancePlanned: null, TssPlanned: null, StartTimePlanned: null, ...props
        })

        test('are ignored without requesting any file', async () => {
            api.getWorkouts.mockResolvedValue([activity(1), tpWorkout(2, { WorkoutFileFormats: undefined }), activity(3)])

            const { workouts } = await syncOnce()

            expect(workouts.map(w => w.workoutId)).toEqual(['2'])
            expect(api.getWorkoutFile).toHaveBeenCalledTimes(1)
            expect(api.getWorkoutFile).toHaveBeenCalledWith(2, 'zwo')
        })

        test('a planned workout that was completed is still a workout (it can be repeated)', async () => {
            api.getWorkouts.mockResolvedValue([tpWorkout(1, { Completed: true, WorkoutFileFormats: undefined })])

            const { workouts } = await syncOnce()

            expect(workouts.map(w => w.workoutId)).toEqual(['1'])
        })

        test.each([
            ['TotalTimePlanned', { TotalTimePlanned: 1 }],
            ['DistancePlanned', { DistancePlanned: 40000 }],
            ['TssPlanned', { TssPlanned: 80 }],
            ['StartTimePlanned', { StartTimePlanned: '2026-11-16T07:00:00' }],
        ])('a single planned value is sufficient: %s', async (_name, planned) => {
            api.getWorkouts.mockResolvedValue([activity(1, planned)])

            expect((await syncOnce()).workouts.map(w => w.workoutId)).toEqual(['1'])
        })

        test('planned values of 0 are no plan', async () => {
            api.getWorkouts.mockResolvedValue([activity(1, { TotalTimePlanned: 0, DistancePlanned: 0, TssPlanned: 0 })])

            expect((await syncOnce()).workouts).toEqual([])
            expect(api.getWorkoutFile).not.toHaveBeenCalled()
        })

        test('planned values are not delivered at all: not known, so the file is requested', async () => {
            const unknown = tpWorkout(1, { WorkoutFileFormats: undefined })
            delete (unknown as { TotalTimePlanned?: unknown }).TotalTimePlanned
            api.getWorkouts.mockResolvedValue([unknown])

            expect((await syncOnce()).workouts.map(w => w.workoutId)).toEqual(['1'])
        })

        test('an activity that is not in the list any more is not reported as deleted', async () => {
            api.getWorkouts.mockResolvedValue([tpWorkout(1), activity(2)])
            await syncOnce()

            api.getWorkouts.mockResolvedValue([tpWorkout(1)])
            const { changes } = await syncOnce()

            expect(changes).toEqual([])
        })

        test('the number of activities is logged', async () => {
            const logSpy = jest.fn()
            service.on('log', logSpy)
            api.getWorkouts.mockResolvedValue([activity(1), tpWorkout(2), tpWorkout(3, { WorkoutType: 'Run' })])

            await syncOnce()

            expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ message: 'workout sync', cntTotal: 3, cntCycling: 2, cntPlanned: 1 }))
        })
    })

    describe('workouts without a file (formats are not provided by the date range)', () => {
        const noFormats = { WorkoutFileFormats: undefined }
        const httpError = (status?: number) => Object.assign(new Error('Request failed'), status ? { response: { status } } : {})

        beforeEach(() => {
            api.getWorkouts.mockResolvedValue([tpWorkout(1, noFormats), tpWorkout(2, noFormats)])
        })

        test('only the workouts that have a file are loaded', async () => {
            api.getWorkoutFile.mockRejectedValueOnce(httpError(404)).mockResolvedValueOnce(zwo)

            const { workouts } = await syncOnce()

            expect(workouts.map(w => w.workoutId)).toEqual(['2'])
        })

        test.each([400, 404, 410, 415, 422])('a workout without file (HTTP %i) is not requested again as long as it is not modified', async (status) => {
            api.getWorkoutFile.mockImplementation(async (id: number) => { if (id === 1) throw httpError(status); return zwo })

            await syncOnce()
            api.getWorkoutFile.mockClear()
            const second = await syncOnce()

            expect(api.getWorkoutFile).not.toHaveBeenCalled()
            expect(second.workouts.map(w => w.workoutId)).toEqual(['2'])
        })

        test('a workout without file is requested again after it was modified', async () => {
            api.getWorkoutFile.mockImplementation(async (id: number) => { if (id === 1) throw httpError(404); return zwo })
            await syncOnce()
            api.getWorkoutFile.mockClear()

            api.getWorkouts.mockResolvedValue([tpWorkout(1, { ...noFormats, LastModifiedDate: '2026-11-12T10:00:00' }), tpWorkout(2, noFormats)])
            api.getWorkoutFile.mockResolvedValue(zwo2)
            const { workouts, changes } = await syncOnce()

            expect(api.getWorkoutFile).toHaveBeenCalledTimes(1)
            expect(api.getWorkoutFile).toHaveBeenCalledWith(1, 'zwo')
            expect(workouts.map(w => w.workoutId)).toEqual(['2', '1'])
            expect(changes.map(([type, w]) => [type, w.workoutId])).toEqual([['added', '1']])
        })

        test.each([
            ['rate limit (429)', httpError(429)],
            ['token (401)', httpError(401)],
            ['forbidden (403)', httpError(403)],
            ['server error (500)', httpError(500)],
            ['network error', httpError()],
        ])('temporary problems are retried on the next sync: %s', async (_name, error) => {
            api.getWorkoutFile.mockRejectedValueOnce(error).mockResolvedValue(zwo)

            const first = await syncOnce()
            expect(first.workouts.map(w => w.workoutId)).toEqual(['2'])

            const second = await syncOnce()
            expect(second.workouts.map(w => w.workoutId)).toEqual(['2', '1'])
        })

        test.each([
            ['an empty file', ''],
            ['a file that is not a workout', 'this is not a workout file'],
        ])('%s is remembered as well', async (_name, content) => {
            api.getWorkoutFile.mockImplementation(async (id: number) => id === 1 ? content : zwo)

            await syncOnce()
            api.getWorkoutFile.mockClear()
            await syncOnce()

            expect(api.getWorkoutFile).not.toHaveBeenCalled()
        })

        test('reset forgets the workouts without file', async () => {
            api.getWorkoutFile.mockImplementation(async (id: number) => { if (id === 1) throw httpError(404); return zwo })
            await syncOnce()
            service.reset()
            api.getWorkoutFile.mockClear()

            await syncOnce()

            expect(api.getWorkoutFile).toHaveBeenCalledTimes(2)
        })

        test('the failure is logged with the HTTP status (no content)', async () => {
            const logSpy = jest.fn()
            service.on('log', logSpy)
            api.getWorkoutFile.mockRejectedValueOnce(httpError(404)).mockResolvedValueOnce(zwo)

            await syncOnce()

            expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ message: 'error loading workout', status: 404, workout: 'Workout 1' }))
        })
    })

    describe('not able to sync', () => {
        test('not connected: nothing is requested', async () => {
            connected = false

            const { event, workouts } = await syncOnce()

            expect(event).toBe('loaded')
            expect(workouts).toEqual([])
            expect(api.getWorkouts).not.toHaveBeenCalled()
        })

        test('workout download not enabled: nothing is requested', async () => {
            enabled = false

            const { event, workouts } = await syncOnce()

            expect(event).toBe('loaded')
            expect(workouts).toEqual([])
            expect(api.getWorkouts).not.toHaveBeenCalled()
        })

        test('request fails: emits `loaded` without workouts and the next sync is again a first sync', async () => {
            api.getWorkouts.mockRejectedValueOnce(new Error('token refresh failed'))
            api.getWorkouts.mockResolvedValueOnce([tpWorkout(1)])

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
            api.getWorkouts.mockResolvedValue([tpWorkout(1), tpWorkout(2)])
            await syncOnce()
            api.getWorkoutFile.mockClear()
        })

        test('unchanged workouts are neither downloaded again nor reported', async () => {
            const { event, workouts, changes } = await syncOnce()

            expect(event).toBe('done')
            expect(changes).toEqual([])
            expect(workouts.map(w => w.workoutId)).toEqual(['1', '2'])
            expect(api.getWorkoutFile).not.toHaveBeenCalled()
        })

        test('a new workout is reported as added', async () => {
            api.getWorkouts.mockResolvedValue([tpWorkout(1), tpWorkout(2), tpWorkout(3)])

            const { event, workouts, changes } = await syncOnce()

            expect(event).toBe('done')
            expect(changes.map(([type, w]) => [type, w.workoutId])).toEqual([['added', '3']])
            expect(workouts.map(w => w.workoutId)).toEqual(['1', '2', '3'])
            expect(api.getWorkoutFile).toHaveBeenCalledTimes(1)
            expect(api.getWorkoutFile).toHaveBeenCalledWith(3, 'zwo')
        })

        test('a modified workout is downloaded again and reported as updated', async () => {
            api.getWorkouts.mockResolvedValue([tpWorkout(1), tpWorkout(2, { LastModifiedDate: '2026-11-12T09:30:00' })])
            api.getWorkoutFile.mockResolvedValue(zwo2)

            const { workouts, changes } = await syncOnce()

            expect(changes.map(([type, w]) => [type, w.workoutId])).toEqual([['updated', '2']])
            expect(api.getWorkoutFile).toHaveBeenCalledTimes(1)
            expect(api.getWorkoutFile).toHaveBeenCalledWith(2, 'zwo')
            expect(workouts).toHaveLength(2)
            expect(workouts[1].updated).toEqual(new Date('2026-11-12T09:30:00'))
        })

        test('a workout that is no longer in the calendar is reported as deleted', async () => {
            api.getWorkouts.mockResolvedValue([tpWorkout(2)])

            const { workouts, changes } = await syncOnce()

            expect(changes.map(([type, w]) => [type, w.workoutId])).toEqual([['deleted', '1']])
            expect(workouts.map(w => w.workoutId)).toEqual(['2'])
        })

        test('a workout that was changed to a type other than cycling is reported as deleted', async () => {
            api.getWorkouts.mockResolvedValue([tpWorkout(1, { WorkoutType: 'Run' }), tpWorkout(2)])

            const { changes } = await syncOnce()

            expect(changes.map(([type, w]) => [type, w.workoutId])).toEqual([['deleted', '1']])
        })

        test('request fails: emits `done` and keeps the known workouts', async () => {
            api.getWorkouts.mockRejectedValueOnce(new Error('ECONNRESET'))

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
            api.getWorkouts.mockResolvedValue([tpWorkout(1)])

            const first = service.sync()
            const second = service.sync()

            expect(second).toBe(first)
            await new Promise<void>(resolve => { first.once('loaded', () => resolve()) })
            expect(api.getWorkouts).toHaveBeenCalledTimes(1)
        })

        test('a stop request ends the sync without downloading further workouts', async () => {
            api.getWorkouts.mockResolvedValue([tpWorkout(1), tpWorkout(2), tpWorkout(3)])

            const workouts = await new Promise<Array<WorkoutCalendarEntry>>(resolve => {
                const observer = service.sync()
                observer.once('loaded', (w: Array<WorkoutCalendarEntry>) => resolve(w))
                observer.emit('stop')
            })

            expect(workouts).toEqual([])
            expect(api.getWorkoutFile).not.toHaveBeenCalled()
        })
    })
})
