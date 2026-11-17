import { Inject } from '../../../base/decorators'
import { Observer } from '../../../base/types/observer'
import { DesktopWorkoutListPageService } from '../index'

describe('DesktopWorkoutListPageService - import', () => {

    let MockUserSettings
    let MockWorkoutList
    let s, service
    let pageObserver, emitSpy

    const makeImported = (id = 'w1', title = 'My Workout') => ({
        getId: jest.fn().mockReturnValue(id),
        getTitle: jest.fn().mockReturnValue(title),
        move: jest.fn()
    })

    const urlFile = (ext: string, name = 'a') => ({ type: 'url', name, ext, dir: '/tmp', delimiter: '/' })

    const importUpdates = () => emitSpy.mock.calls.filter(c => c[0] === 'import-update').length
    const flush = () => new Promise(resolve => setImmediate(resolve))

    beforeEach(() => {
        MockUserSettings = { get: jest.fn((_k, def) => def), set: jest.fn() }
        MockWorkoutList = {
            open: jest.fn().mockReturnValue({ observer: new Observer(), lists: [] }),
            close: jest.fn(),
            getLists: jest.fn().mockReturnValue([]),
            import: jest.fn().mockResolvedValue([makeImported()])
        }
        Inject('WorkoutList', MockWorkoutList)
        Inject('UserSettings', MockUserSettings)

        s = service = new DesktopWorkoutListPageService()
        s.logError = jest.fn()
        s.logEvent = jest.fn()
        pageObserver = service.getPageObserver() ?? service.openPage()
        emitSpy = jest.spyOn(pageObserver, 'emit')
    })

    afterEach(() => {
        Inject('WorkoutList', null)
        Inject('UserSettings', null)
        s.reset()
    })

    describe('onImportFiles', () => {

        test.each([
            ['url shape', urlFile('zwo')],
            ['json', urlFile('json')],
            ['uppercase extension', urlFile('ZWO')],
            ['browser shape', { type: 'file', file: { name: 'a.zwo', ext: '.zwo' } }],
            ['extension only in the name', { type: 'file', file: { name: 'a.JSON' } }]
        ])('%s: imports without import cards and ends in the result phase', async (_name, file) => {
            service.onImportFiles(file, 'dialog')

            expect(service.getImportDisplayProps().phase).toBe('importing')
            expect(MockWorkoutList.import).toHaveBeenCalledWith(file, { showImportCards: false })

            await flush()

            expect(service.getImportDisplayProps()).toMatchObject({ phase: 'result', result: { id: 'w1', workoutName: 'My Workout' } })
            expect(s.logEvent).toHaveBeenCalledWith({ message: 'workout import requested', source: 'dialog', fileCount: 1 })
        })

        test('an array with one file is accepted', async () => {
            service.onImportFiles([urlFile('zwo')], 'page-drop')
            await flush()
            expect(MockWorkoutList.import).toHaveBeenCalledTimes(1)
            expect(service.getImportDisplayProps().phase).toBe('result')
        })

        test('emits import-update on every transition', async () => {
            service.onImportFiles(urlFile('zwo'), 'dialog')
            expect(importUpdates()).toBe(1)
            await flush()
            expect(importUpdates()).toBe(2)
        })

        test('several files are rejected without calling the domain', () => {
            service.onImportFiles([urlFile('zwo'), urlFile('zwo', 'b')], 'page-drop')

            expect(MockWorkoutList.import).not.toHaveBeenCalled()
            expect(service.getImportDisplayProps()).toMatchObject({ phase: 'error', error: 'Only one workout file at a time' })
            expect(importUpdates()).toBe(1)
            expect(s.logEvent).toHaveBeenCalledWith({ message: 'workout import rejected', reason: 'multiple-files', fileCount: 2 })
        })

        test('unsupported types are rejected without calling the domain', () => {
            service.onImportFiles(urlFile('gpx'), 'dialog')

            expect(MockWorkoutList.import).not.toHaveBeenCalled()
            expect(service.getImportDisplayProps()).toMatchObject({ phase: 'error', error: 'Unsupported file type - please choose a ZWO or JSON file' })
            expect(s.logEvent).toHaveBeenCalledWith({ message: 'workout import rejected', reason: 'unsupported-type', fileCount: 1, ext: 'gpx' })
        })

        test('a file without extension is rejected', () => {
            service.onImportFiles({ type: 'file', file: { name: 'noext' } }, 'dialog')
            expect(service.getImportDisplayProps().phase).toBe('error')
        })

        test('an empty list is a logged no-op', () => {
            service.onImportFiles([], 'page-drop')

            expect(MockWorkoutList.import).not.toHaveBeenCalled()
            expect(service.getImportDisplayProps().phase).toBe('landing')
            expect(importUpdates()).toBe(0)
            expect(s.logEvent).toHaveBeenCalledWith({ message: 'workout import rejected', reason: 'no-file', fileCount: 0 })
        })

        test('a parse failure ends in the error phase with the service message and does not throw', async () => {
            MockWorkoutList.import.mockRejectedValue(new Error('invalid file format xml'))

            service.onImportFiles(urlFile('zwo'), 'dialog')
            await flush()

            expect(service.getImportDisplayProps()).toMatchObject({ phase: 'error', error: 'invalid file format xml' })
            expect(importUpdates()).toBe(2)
        })

        test('a new valid import clears the previous error', async () => {
            service.onImportFiles(urlFile('gpx'), 'dialog')
            service.onImportFiles(urlFile('zwo'), 'dialog')

            expect(service.getImportDisplayProps()).toEqual({ phase: 'importing', knownGroups: expect.any(Array), importing: { fileName: 'a' } })
            await flush()
        })
    })

    describe('onImportOpen', () => {
        test('after an error returns to the landing phase', () => {
            service.onImportFiles(urlFile('gpx'), 'dialog')
            service.onImportOpen()
            expect(service.getImportDisplayProps().phase).toBe('landing')
        })
    })
})
