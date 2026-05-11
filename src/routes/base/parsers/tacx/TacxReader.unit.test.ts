import { TacxFileReader } from './TacxReader'
import { loadFile } from '../../../../../__tests__/utils/loadFile'
import {
    FP_PGMF, FP_RLV, FP_CAF, FP_IMF,
    RLV_VIDEO_INFO, RLV_FRAME_DISTANCE_MAPPING, RLV_INFOBOX,
    COURSE_INFO, GENERAL_INFO, PROGRAM_DETAILS
} from '../../model/tacx'

describe('TacxFileReader', () => {
    describe('isValid', () => {
        test('valid pgmf file', async () => {
            const file = './__tests__/data/rlv/ES_Andalusia-1.pgmf'
            const data = await loadFile(null, file) as ArrayBuffer

            const isValid = TacxFileReader.isValid(data)
            expect(isValid).toBe(true)
        })

        test('valid rlv file', async () => {
            const file = './__tests__/data/rlv/ES_Andalusia-1.rlv'
            const data = await loadFile(null, file) as ArrayBuffer

            const isValid = TacxFileReader.isValid(data)
            expect(isValid).toBe(true)
        })

        test('valid pgmf file (second test file)', async () => {
            const file = './__tests__/data/rlv/IS_West.pgmf'
            const data = await loadFile(null, file) as ArrayBuffer

            const isValid = TacxFileReader.isValid(data)
            expect(isValid).toBe(true)
        })

        test('valid rlv file (second test file)', async () => {
            const file = './__tests__/data/rlv/IS_West.rlv'
            const data = await loadFile(null, file) as ArrayBuffer

            const isValid = TacxFileReader.isValid(data)
            expect(isValid).toBe(true)
        })

        test('invalid file format', () => {
            const invalidData = new ArrayBuffer(4)
            const view = new Uint8Array(invalidData)
            view[0] = 0xFF
            view[1] = 0xFF

            const isValid = TacxFileReader.isValid(invalidData)
            expect(isValid).toBe(false)
        })

        test('empty data', () => {
            const emptyData = new ArrayBuffer(0)

            const isValid = TacxFileReader.isValid(emptyData)
            expect(isValid).toBe(false)
        })

        test('truncated data', () => {
            const truncatedData = new ArrayBuffer(1)

            const isValid = TacxFileReader.isValid(truncatedData)
            expect(isValid).toBe(false)
        })
    })

    describe('parseFileType', () => {
        let reader: TacxFileReader<any>

        beforeEach(() => {
            reader = new TacxFileReader()
        })

        test('pgmf file type', () => {
            const fileType = (reader as any).constructor.parseFileType(FP_PGMF)
            expect(fileType).toBe('pgmf')
        })

        test('rlv file type', () => {
            const fileType = (reader as any).constructor.parseFileType(FP_RLV)
            expect(fileType).toBe('rlv')
        })

        test('caf file type', () => {
            const fileType = (reader as any).constructor.parseFileType(FP_CAF)
            expect(fileType).toBe('caf')
        })

        test('imf file type', () => {
            const fileType = (reader as any).constructor.parseFileType(FP_IMF)
            expect(fileType).toBe('imf')
        })

        test('unknown file type', () => {
            expect(() => {
                (reader as any).constructor.parseFileType(9999)
            }).toThrow('Unknown file type: 9999')
        })
    })

    describe('parseBlockType', () => {
        let reader: TacxFileReader<any>

        beforeEach(() => {
            reader = new TacxFileReader()
        })

        test('RLV Video info block type', () => {
            const blockType = (reader as any).constructor.parseBlockType(RLV_VIDEO_INFO)
            expect(blockType).toBe('RLV Video info')
        })

        test('RLV Frame/Distance Mapping block type', () => {
            const blockType = (reader as any).constructor.parseBlockType(RLV_FRAME_DISTANCE_MAPPING)
            expect(blockType).toBe('RLV Frame/Distance Mapping')
        })

        test('RLV InfoBox info block type', () => {
            const blockType = (reader as any).constructor.parseBlockType(RLV_INFOBOX)
            expect(blockType).toBe('RLV InfoBox info')
        })

        test('Course info block type', () => {
            const blockType = (reader as any).constructor.parseBlockType(COURSE_INFO)
            expect(blockType).toBe('Course info')
        })

        test('General Info block type', () => {
            const blockType = (reader as any).constructor.parseBlockType(GENERAL_INFO)
            expect(blockType).toBe('General Info')
        })

        test('Program block type', () => {
            const blockType = (reader as any).constructor.parseBlockType(PROGRAM_DETAILS)
            expect(blockType).toBe('Program')
        })

        test('unknown block type', () => {
            expect(() => {
                (reader as any).constructor.parseBlockType(9999)
            }).toThrow('Unknown block type: 9999')
        })
    })

})
