import { Decoder, Stream } from '@garmin/fitsdk'
import { ActivityDetails } from '../../model'
import { LocalFitConverter } from './index'

import fittestData from '../../../../../__tests__/data/activities/fittest.json'
import vancouverData from '../../../../../__tests__/data/activities/vancouver.json'
import withWorkoutData from '../../../../../__tests__/data/activities/with_workout.json'
import activityData from '../../../../../__tests__/data/activities/activity.json'
import bostonData from '../../../../../__tests__/data/activities/boston.json'
import palmcoveData from '../../../../../__tests__/data/activities/palmcove.json'
import laptestData from '../../../../../__tests__/data/activities/laptest.json'

const fixtures: Array<{ name: string; data: unknown }> = [
    { name: 'fittest',      data: fittestData },
    { name: 'vancouver',    data: vancouverData },
    { name: 'with_workout', data: withWorkoutData },
    { name: 'activity',     data: activityData },
    { name: 'boston',       data: bostonData },
    { name: 'palmcove',     data: palmcoveData },
    { name: 'laptest',      data: laptestData },
]

describe('LocalFitConverter', () => {
    let converter: LocalFitConverter

    beforeEach(() => {
        converter = new LocalFitConverter()
        ;(converter as unknown as Record<string, unknown>).getUserSettings = jest.fn().mockReturnValue({
            get: jest.fn((_key: string, defValue: unknown) => defValue),
        })
    })

    afterEach(() => {
        jest.clearAllMocks()
    })

    describe('convert', () => {
        fixtures.forEach(({ name, data }) => {
            test(`${name} — produces a valid parseable FIT file`, async () => {
                const activity = data as unknown as ActivityDetails
                const result = await converter.convert(activity)

                expect(result).toBeInstanceOf(ArrayBuffer)

                const bytes = Array.from(new Uint8Array(result as ArrayBuffer))
                const stream = Stream.fromByteArray(bytes)
                expect(Decoder.isFIT(stream)).toBe(true)

                const decoder = new Decoder(Stream.fromByteArray(bytes))
                expect(decoder.checkIntegrity()).toBe(true)

                const { messages, errors } = decoder.read()
                expect(errors).toHaveLength(0)
                expect(messages.sessionMesgs).toHaveLength(1)
                expect(messages.activityMesgs).toHaveLength(1)
            })

            test(`${name} — session summary fields match input`, async () => {
                const activity = data as unknown as ActivityDetails
                const result = await converter.convert(activity)

                const bytes = Array.from(new Uint8Array(result as ArrayBuffer))
                const { messages } = new Decoder(Stream.fromByteArray(bytes)).read()

                const session = messages.sessionMesgs?.[0] as Record<string, unknown>
                expect(session).toBeDefined()

                const src = activity as unknown as Record<string, unknown>

                if (src.distance != null) {
                    expect(session.totalDistance as number).toBeCloseTo(src.distance as number, 1)
                }
                if (src.time != null) {
                    expect(session.totalTimerTime as number).toBeCloseTo(src.time as number, 1)
                }
                if (src.timeTotal != null) {
                    expect(session.totalElapsedTime as number).toBeCloseTo(src.timeTotal as number, 1)
                }
            })

            test(`${name} — record count matches log count`, async () => {
                const activity = data as unknown as ActivityDetails
                const src = activity as unknown as Record<string, unknown>
                const logs = src.logs as unknown[]
                if (!logs?.length) return

                const result = await converter.convert(activity)
                const bytes = Array.from(new Uint8Array(result as ArrayBuffer))
                const { messages } = new Decoder(Stream.fromByteArray(bytes)).read()

                expect(messages.recordMesgs).toHaveLength(logs.length)
            })
        })

        test('conversion failure propagates error', async () => {
            const activity = vancouverData as unknown as ActivityDetails
            jest.spyOn(converter as never, 'encode').mockImplementation(() => {
                throw new Error('encode error')
            })
            await expect(converter.convert(activity)).rejects.toThrow('encode error')
        })
    })

    describe('encode — GPS coordinate mapping', () => {
        test('lat/lng degrees are converted to semicircles', async () => {
            // activity.json uses lng (not deprecated lon), so GPS survives mapLogToFit
            const activity = activityData as unknown as ActivityDetails
            const result = await converter.convert(activity)

            const bytes = Array.from(new Uint8Array(result as ArrayBuffer))
            const { messages } = new Decoder(Stream.fromByteArray(bytes)).read()
            const records = messages.recordMesgs as Array<Record<string, unknown>>

            const firstLog = activityData.logs[0] as Record<string, unknown>
            const firstLat = firstLog.lat as number
            const firstLng = firstLog.lng as number

            const DEG_TO_SEMICIRCLES = (2 ** 31) / 180
            const expectedLat = Math.round(firstLat * DEG_TO_SEMICIRCLES)
            const expectedLon = Math.round(firstLng * DEG_TO_SEMICIRCLES)

            const gpsRecord = records.find(r => r.positionLat != null)
            expect(gpsRecord).toBeDefined()
            expect(gpsRecord?.positionLat as number).toBeCloseTo(expectedLat, -3)
            expect(gpsRecord?.positionLong as number).toBeCloseTo(expectedLon, -3)
        })

        test('records without GPS do not have position fields', async () => {
            const activity = withWorkoutData as unknown as ActivityDetails
            const result = await converter.convert(activity)

            const bytes = Array.from(new Uint8Array(result as ArrayBuffer))
            const { messages } = new Decoder(Stream.fromByteArray(bytes)).read()
            const records = messages.recordMesgs as Array<Record<string, unknown>>

            expect(records.every(r => r.positionLat == null)).toBe(true)
        })
    })

    describe('encode — integer rounding', () => {
        test('non-integer cadence, heartrate, and power are rounded to integers', async () => {
            const activity = vancouverData as unknown as ActivityDetails
            const src = activity as unknown as Record<string, unknown>
            const logsCopy = [...(src.logs as Array<Record<string, unknown>>)]
            logsCopy[0] = { ...logsCopy[0], cadence: 90.1, power: 123.456, heartrate: 145.678 }
            const modified = { ...src, logs: logsCopy } as unknown as ActivityDetails

            const result = await converter.convert(modified)
            const bytes = Array.from(new Uint8Array(result as ArrayBuffer))
            const { messages } = new Decoder(Stream.fromByteArray(bytes)).read()
            const records = messages.recordMesgs as Array<Record<string, unknown>>

            expect(records[0].cadence).toBe(90)
            expect(records[0].heartRate).toBe(146)
            expect(records[0].power).toBe(123)
        })
    })
})
