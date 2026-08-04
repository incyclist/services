import fs from 'fs'
import path from 'path'
import { parseMp4Boxes } from './Mp4BoxParser'

const dataDir = path.join(__dirname, '../../__tests__/data/video')

const readFixture = (name: string): Buffer => fs.readFileSync(path.join(dataDir, name))

describe('parseMp4Boxes', () => {

    test('faststart mp4 (moov near start): identifies codec from head chunk alone', () => {
        const file = readFixture('faststart_h264.mp4')
        const head = file.subarray(0, 3000)

        const result = parseMp4Boxes(head, undefined)

        expect(result.moovLocation).toBe('head')
        expect(result.incomplete).toBe(false)
        expect(result.containerBrand).toBeDefined()
        expect(result.videoCodec).toBe('avc1')
        expect(result.audioCodec).toBe('mp4a')
        expect(result.width).toBeGreaterThan(0)
        expect(result.height).toBeGreaterThan(0)
    })

    test('non-faststart mp4 (moov at end): head alone is not enough, tail chunk finds it', () => {
        const file = readFixture('nofaststart_h264.mp4')
        const head = file.subarray(0, 2000) // ends well before moov (starts at byte 9575)
        const tail = file.subarray(file.length - 3000)

        const headOnlyResult = parseMp4Boxes(head, undefined)
        expect(headOnlyResult.moovLocation).toBe('not-found')
        expect(headOnlyResult.incomplete).toBe(true)
        expect(headOnlyResult.videoCodec).toBeUndefined()

        const result = parseMp4Boxes(head, tail)
        expect(result.moovLocation).toBe('tail')
        expect(result.incomplete).toBe(false)
        expect(result.videoCodec).toBe('avc1')
        expect(result.audioCodec).toBe('mp4a')
    })

    test('hevc mp4: identifies hev1/hvc1 codec fourcc, not just "video"', () => {
        const file = readFixture('faststart_hevc.mp4')
        const head = file.subarray(0, 5000)

        const result = parseMp4Boxes(head, undefined)

        expect(result.moovLocation).toBe('head')
        expect(['hev1', 'hvc1']).toContain(result.videoCodec)
        expect(result.audioCodec).toBe('mp4a')
    })

    test('neither chunk contains moov: reports not-found/incomplete rather than throwing', () => {
        const file = readFixture('nofaststart_h264.mp4')
        const head = file.subarray(0, 2000)
        const tail = file.subarray(file.length - 100, file.length - 50) // arbitrary slice, no moov

        const result = parseMp4Boxes(head, tail)

        expect(result.moovLocation).toBe('not-found')
        expect(result.incomplete).toBe(true)
        expect(result.videoCodec).toBeUndefined()
        expect(result.audioCodec).toBeUndefined()
    })

    test('no buffers at all: returns not-found/incomplete without throwing', () => {
        const result = parseMp4Boxes(undefined, undefined)

        expect(result.moovLocation).toBe('not-found')
        expect(result.incomplete).toBe(true)
    })

    test('empty/garbage buffer: does not throw, reports not-found', () => {
        const result = parseMp4Boxes(Buffer.from([1, 2, 3, 4, 5]), Buffer.alloc(0))

        expect(result.moovLocation).toBe('not-found')
        expect(result.incomplete).toBe(true)
    })
})
