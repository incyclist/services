import { EventEmitter } from 'node:events'
import { Inject } from '../base/decorators'
import { VideoConversion } from './VideoConversion'

describe('VideoConversion', () => {

    describe('convert', () => {
        let conversion: VideoConversion
        let platformConversion: EventEmitter & { next?: jest.Mock, stop?: jest.Mock }
        let convertOnline: jest.Mock

        beforeEach(() => {
            platformConversion = new EventEmitter()
            platformConversion.next = jest.fn().mockResolvedValue('segment')
            convertOnline = jest.fn().mockResolvedValue(platformConversion)

            Inject('VideoBindings', { convertOnline })
            conversion = new VideoConversion('video:///route.avi')
        })

        afterEach(() => {
            Inject('VideoBindings', null)
            jest.clearAllMocks()
        })

        test('passes the requested props to the platform', async () => {
            await conversion.convert({ foo: 'bar' })

            expect(convertOnline).toHaveBeenCalledWith('video:///route.avi', { progressInterval: 1, foo: 'bar' })
        })

        test('includes the audio track when the platform can stream it', async () => {
            Inject('VideoBindings', { convertOnline, isConvertAudioSupported: () => true })
            conversion = new VideoConversion('video:///route.avi')

            expect(conversion.isAudioSupported()).toBe(true)
            await conversion.convert()

            expect(convertOnline).toHaveBeenCalledWith('video:///route.avi', { progressInterval: 1, audio: true })
        })

        test('video only on platforms without audio in conversions', async () => {
            Inject('VideoBindings', { convertOnline, isConvertAudioSupported: () => false })
            conversion = new VideoConversion('video:///route.avi')

            expect(conversion.isAudioSupported()).toBe(false)
            await conversion.convert()

            expect(convertOnline).toHaveBeenCalledWith('video:///route.avi', { progressInterval: 1 })
        })

        test('older platforms without the capability stream video only', async () => {
            await conversion.convert()

            expect(conversion.isAudioSupported()).toBe(false)
            expect(convertOnline).toHaveBeenCalledWith('video:///route.avi', { progressInterval: 1 })
        })

        test('passes the start info (MIME type) on with convert-start', async () => {
            const onStart = jest.fn()
            conversion.getObserver().on('convert-start', onStart)
            await conversion.convert()

            const info = { mime: 'video/mp4; codecs="avc1.64001F, mp4a.40.2"' }
            platformConversion.emit('started', info)

            expect(onStart).toHaveBeenCalledWith(info)
        })

        test('convert-start without info from older platforms', async () => {
            const onStart = jest.fn()
            conversion.getObserver().on('convert-start', onStart)
            await conversion.convert()

            platformConversion.emit('started')

            expect(onStart).toHaveBeenCalledWith(undefined)
        })
    })
})
