import path from 'path'
import { getBindings } from '../../../../api'
import {RLVFileReader} from './rlv'
import fs from 'fs'
import { IFileSystem } from '../../../../api/fs'
import { Inject } from '../../../../base/decorators'
import { IncyclistBindings } from '../../../../api/bindings'
import { loadFile } from '../../../../../__tests__/utils/loadFile'

describe ('RLV Reader', ()=>{

    describe ('parse', ()=>{

        let reader: RLVFileReader
        let mockBindings: Partial<IncyclistBindings>

        beforeEach(() => {
            mockBindings = { path, fs: fs as unknown as IFileSystem }
            Inject('Bindings', mockBindings)
            reader = new RLVFileReader()
        })

        afterEach(() => {
            Inject('Bindings', null)
            jest.clearAllMocks()
        })

        test('parses ES_Andalusia-1 file correctly', async () => {
            const file = './__tests__/data/rlv/ES_Andalusia-1.rlv'
            const data = await loadFile(null, file) as ArrayBuffer

            const fileInfo = reader.parse(data)

            expect(fileInfo.fileType).toBe('rlv')
            expect(fileInfo.rlvInfo?.videoFile).toBe('D:\\RLV-Training\\RLV\\ES_Andalusia-1\\ES_Andalusia-1.avi')
            expect(fileInfo.rlvInfo?.framerate).toBe(25)
            expect(fileInfo.rlvInfo?.orgRunWeight).toBeGreaterThanOrEqual(0)
            expect(fileInfo.rlvInfo?.frameOffset).toBeDefined()
            expect(fileInfo.mapping?.length).toBe(1066)
            expect(fileInfo.infoBoxes?.length).toBe(0)
            expect(fileInfo.courseInfo?.length).toBe(3)
        })

        test('parses IS_West file correctly', async () => {
            const file = './__tests__/data/rlv/IS_West.rlv'
            const data = await loadFile(null, file) as ArrayBuffer

            const fileInfo = reader.parse(data)

            expect(fileInfo.fileType).toBe('rlv')
            expect(fileInfo.rlvInfo?.videoFile).toBeDefined()
            expect(fileInfo.rlvInfo?.framerate).toBeGreaterThan(0)
            expect(fileInfo.mapping).toBeDefined()
            expect(fileInfo.mapping?.length).toBeGreaterThan(0)
            expect(fileInfo.courseInfo).toBeDefined()
        })

        test('course info contains valid segments', async () => {
            const file = './__tests__/data/rlv/ES_Andalusia-1.rlv'
            const data = await loadFile(null, file) as ArrayBuffer

            const fileInfo = reader.parse(data)

            expect(fileInfo.courseInfo).toBeDefined()
            fileInfo.courseInfo?.forEach(segment => {
                expect(segment.start).toBeGreaterThanOrEqual(0)
                expect(segment.end).toBeGreaterThanOrEqual(segment.start)
                expect(segment.segmentName).toBeDefined()
                expect(typeof segment.segmentName).toBe('string')
                expect(segment.textFile).toBeDefined()
            })
        })

        test('frame distance mapping contains valid records', async () => {
            const file = './__tests__/data/rlv/ES_Andalusia-1.rlv'
            const data = await loadFile(null, file) as ArrayBuffer

            const fileInfo = reader.parse(data)

            expect(fileInfo.mapping).toBeDefined()
            fileInfo.mapping?.forEach((record, index) => {
                expect(record.frameNumber).toBeGreaterThanOrEqual(0)
                expect(record.distancePerFrame).toBeGreaterThanOrEqual(0)
                if (index > 0) {
                    expect(record.frameNumber).toBeGreaterThanOrEqual(fileInfo.mapping![index - 1].frameNumber)
                }
            })
        })

        test('throws error on invalid file type (pgmf instead of rlv)', async () => {
            const file = './__tests__/data/rlv/ES_Andalusia-1.pgmf'
            const data = await loadFile(null, file) as ArrayBuffer

            expect (() => reader.parse(data)).toThrow('Invalid file type')
        })

        test('rlvInfo has all required properties', async () => {
            const file = './__tests__/data/rlv/ES_Andalusia-1.rlv'
            const data = await loadFile(null, file) as ArrayBuffer

            const fileInfo = reader.parse(data)

            expect(fileInfo.rlvInfo).toBeDefined()
            expect(fileInfo.rlvInfo).toHaveProperty('videoFile')
            expect(fileInfo.rlvInfo).toHaveProperty('framerate')
            expect(fileInfo.rlvInfo).toHaveProperty('orgRunWeight')
            expect(fileInfo.rlvInfo).toHaveProperty('frameOffset')
        })

        test('parsing multiple files sequentially works correctly', async () => {
            const file1 = './__tests__/data/rlv/ES_Andalusia-1.rlv'
            const file2 = './__tests__/data/rlv/IS_West.rlv'

            const data1 = await loadFile(null, file1) as ArrayBuffer
            const data2 = await loadFile(null, file2) as ArrayBuffer

            const reader1 = new RLVFileReader()
            const reader2 = new RLVFileReader()

            const fileInfo1 = reader1.parse(data1)
            const fileInfo2 = reader2.parse(data2)

            expect(fileInfo1.rlvInfo?.videoFile).not.toBe(fileInfo2.rlvInfo?.videoFile)
            expect(fileInfo1.blockCount).toBeGreaterThan(0)
            expect(fileInfo2.blockCount).toBeGreaterThan(0)
        })

    })
})