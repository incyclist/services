import path from 'path'
import { getBindings } from '../../../../api'
import {PGMFFileReader} from './pgmf'
import fs from 'fs'
import { IFileSystem } from '../../../../api/fs'
import { Inject } from '../../../../base/decorators'
import { IncyclistBindings } from '../../../../api/bindings'
import { loadFile } from '../../../../../__tests__/utils/loadFile'

describe ('PGMF Reader', ()=>{

    describe ('parse', ()=>{

        let reader: PGMFFileReader
        let mockBindings: Partial<IncyclistBindings>

        beforeEach(() => {
            mockBindings = { path, fs: fs as unknown as IFileSystem }
            Inject('Bindings', mockBindings)
            reader = new PGMFFileReader()
        })

        afterEach(() => {
            Inject('Bindings', null)
            jest.clearAllMocks()
        })

        test('parses ES_Andalusia-1 file correctly', async () => {
            const file = './__tests__/data/rlv/ES_Andalusia-1.pgmf'
            const data = await loadFile(null, file) as ArrayBuffer

            const fileInfo = reader.parse(data)

            expect(fileInfo.fileType).toBe('pgmf')
            expect(fileInfo.generalInfo).toMatchObject({
                checksum: 4046398331,
                courseName: 'ES_Andalusia-1',
                wattSlopePulse: 1,
                timeDist: 1,
                totalTimeDist: 0,
                energyCons: 0,
                altitudeStart: expect.closeTo(58.7, 1),
                brakeCategory: 0
            })
            const cntPoints = fileInfo.program
            expect(cntPoints).toHaveLength(1935)
            expect(cntPoints?.filter(p => p.slope !== undefined)).toHaveLength(1935)
        })

        test('parses IS_West file correctly', async () => {
            const file = './__tests__/data/rlv/IS_West.pgmf'
            const data = await loadFile(null, file) as ArrayBuffer

            const fileInfo = reader.parse(data)

            expect(fileInfo.fileType).toBe('pgmf')
            expect(fileInfo.generalInfo).toBeDefined()
            expect(fileInfo.generalInfo?.courseName).toBe('IS_West')
            expect(fileInfo.program).toBeDefined()
            expect(fileInfo.program!.length).toBeGreaterThan(0)
        })

        test('general info contains valid data', async () => {
            const file = './__tests__/data/rlv/ES_Andalusia-1.pgmf'
            const data = await loadFile(null, file) as ArrayBuffer

            const fileInfo = reader.parse(data)

            expect(fileInfo.generalInfo).toBeDefined()
            expect(fileInfo.generalInfo?.checksum).toBeGreaterThan(0)
            expect(fileInfo.generalInfo?.courseName).toBeDefined()
            expect(typeof fileInfo.generalInfo?.courseName).toBe('string')
            expect(fileInfo.generalInfo?.altitudeStart).toBeGreaterThanOrEqual(0)
        })

        test('program records contain valid slope data', async () => {
            const file = './__tests__/data/rlv/ES_Andalusia-1.pgmf'
            const data = await loadFile(null, file) as ArrayBuffer

            const fileInfo = reader.parse(data)

            expect(fileInfo.program).toBeDefined()
            fileInfo.program?.forEach(record => {
                expect(record.durationDistance).toBeGreaterThan(0)
                expect(record.rollingFriction).toBeGreaterThanOrEqual(0)
                expect(record.slope).toBeDefined()
                expect(typeof record.slope).toBe('number')
            })
        })

        test('program contains all records from file', async () => {
            const file = './__tests__/data/rlv/ES_Andalusia-1.pgmf'
            const data = await loadFile(null, file) as ArrayBuffer

            const fileInfo = reader.parse(data)

            expect(fileInfo.program?.length).toBe(1935)
            expect(fileInfo.blockCount).toBeGreaterThanOrEqual(2)
        })

        test('throws error on invalid file type (rlv instead of pgmf)', async () => {
            const file = './__tests__/data/rlv/ES_Andalusia-1.rlv'
            const data = await loadFile(null, file) as ArrayBuffer

            expect (() => reader.parse(data)).toThrow('Invalid file type')
        })

        test('general info has all required properties', async () => {
            const file = './__tests__/data/rlv/ES_Andalusia-1.pgmf'
            const data = await loadFile(null, file) as ArrayBuffer

            const fileInfo = reader.parse(data)

            expect(fileInfo.generalInfo).toHaveProperty('checksum')
            expect(fileInfo.generalInfo).toHaveProperty('courseName')
            expect(fileInfo.generalInfo).toHaveProperty('wattSlopePulse')
            expect(fileInfo.generalInfo).toHaveProperty('timeDist')
            expect(fileInfo.generalInfo).toHaveProperty('totalTimeDist')
            expect(fileInfo.generalInfo).toHaveProperty('energyCons')
            expect(fileInfo.generalInfo).toHaveProperty('altitudeStart')
            expect(fileInfo.generalInfo).toHaveProperty('brakeCategory')
        })

        test('program records have slope when wattSlopePulse is SLOPE_PROGRAM', async () => {
            const file = './__tests__/data/rlv/ES_Andalusia-1.pgmf'
            const data = await loadFile(null, file) as ArrayBuffer

            const fileInfo = reader.parse(data)

            expect(fileInfo.generalInfo?.wattSlopePulse).toBe(1) // SLOPE_PROGRAM = 1
            fileInfo.program?.forEach(record => {
                expect(record.slope).toBeDefined()
                expect(record.watts).toBeUndefined()
                expect(record.pulse).toBeUndefined()
            })
        })

        test('parsing multiple files sequentially works correctly', async () => {
            const file1 = './__tests__/data/rlv/ES_Andalusia-1.pgmf'
            const file2 = './__tests__/data/rlv/IS_West.pgmf'

            const data1 = await loadFile(null, file1) as ArrayBuffer
            const data2 = await loadFile(null, file2) as ArrayBuffer

            const reader1 = new PGMFFileReader()
            const reader2 = new PGMFFileReader()

            const fileInfo1 = reader1.parse(data1)
            const fileInfo2 = reader2.parse(data2)

            expect(fileInfo1.generalInfo?.courseName).not.toBe(fileInfo2.generalInfo?.courseName)
            expect(fileInfo1.program!.length).toBeGreaterThan(0)
            expect(fileInfo2.program!.length).toBeGreaterThan(0)
        })

        test('altitude start is reasonable for typical training file', async () => {
            const file = './__tests__/data/rlv/ES_Andalusia-1.pgmf'
            const data = await loadFile(null, file) as ArrayBuffer

            const fileInfo = reader.parse(data)

            expect(fileInfo.generalInfo?.altitudeStart).toBeGreaterThan(0)
            expect(fileInfo.generalInfo?.altitudeStart).toBeLessThan(10000) // Reasonable altitude limit
        })

    })
})