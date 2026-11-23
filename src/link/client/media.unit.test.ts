import { getBindings } from '../../api/bindings'
import { LinkMediaPath } from './media'
import type { LinkClientPlatform } from './types'

describe('LinkMediaPath', () => {
    const bindings = getBindings() as unknown as Record<string, unknown>
    let platform: LinkClientPlatform
    let pipe: { start: jest.Mock, stop: jest.Mock }
    let media: LinkMediaPath

    beforeEach(() => {
        platform = 'ios'
        pipe = { start: jest.fn(async () => ({ port: 5555 })), stop: jest.fn(async () => undefined) }
        media = new LinkMediaPath(() => platform)
    })
    afterEach(() => {
        delete bindings.loopbackPipe
    })

    test('iOS goes direct', async () => {
        expect(await media.getBaseUrl('l1', '192.168.1.2', 6002)).toBe('http://192.168.1.2:6002')
        expect(media.usesPipe()).toBe(false)
    })
    test('an IPv6 host is bracketed', async () => {
        expect(await media.getBaseUrl('l1', 'fe80::1', 6002)).toBe('http://[fe80::1]:6002')
    })
    test('no media without a media port', async () => {
        expect(await media.getBaseUrl('l1', '192.168.1.2', 0)).toBeUndefined()
    })
    test('Android uses the pipe, started once for one upstream', async () => {
        platform = 'android'
        bindings.loopbackPipe = pipe
        const [a, b] = await Promise.all([media.getBaseUrl('l1', '192.168.1.2', 6002), media.getBaseUrl('l1', '192.168.1.2', 6002)])
        expect(a).toBe('http://127.0.0.1:5555')
        expect(b).toBe(a)
        expect(pipe.start).toHaveBeenCalledTimes(1)
    })
    test('a new upstream (the computer restarted) replaces the pipe', async () => {
        platform = 'android'
        bindings.loopbackPipe = pipe
        await media.getBaseUrl('l1', '192.168.1.2', 6002)
        pipe.start.mockResolvedValueOnce({ port: 6666 })
        expect(await media.getBaseUrl('l1', '192.168.1.2', 6100)).toBe('http://127.0.0.1:6666')
        expect(pipe.stop).toHaveBeenCalledWith(5555)
    })
    test('every computer gets its own pipe', async () => {
        platform = 'android'
        bindings.loopbackPipe = pipe
        await media.getBaseUrl('l1', '192.168.1.2', 6002)
        pipe.start.mockResolvedValueOnce({ port: 6666 })
        expect(await media.getBaseUrl('l2', '192.168.1.3', 6002)).toBe('http://127.0.0.1:6666')
        await media.release()
        expect(pipe.stop).toHaveBeenCalledWith(5555)
        expect(pipe.stop).toHaveBeenCalledWith(6666)
    })
    test('Android without the pipe binding: unavailable', async () => {
        platform = 'android'
        expect(media.isAvailable()).toBe(false)
        expect(await media.getBaseUrl('l1', '192.168.1.2', 6002)).toBeUndefined()
    })
    test('a pipe that cannot start means no media', async () => {
        platform = 'android'
        bindings.loopbackPipe = pipe
        pipe.start.mockRejectedValue(new Error('x'))
        expect(await media.getBaseUrl('l1', '192.168.1.2', 6002)).toBeUndefined()
    })
    test('a pipe that starts with port 0 means no media', async () => {
        platform = 'android'
        bindings.loopbackPipe = pipe
        pipe.start.mockResolvedValue({ port: 0 })
        expect(await media.getBaseUrl('l1', '192.168.1.2', 6002)).toBeUndefined()
    })
    test('the pipe can be switched on for iOS, but only when the binding exists', async () => {
        media.setPipeEnabled(true)
        expect(media.usesPipe()).toBe(false)
        bindings.loopbackPipe = pipe
        expect(media.usesPipe()).toBe(true)
        expect(await media.getBaseUrl('l1', '192.168.1.2', 6002)).toBe('http://127.0.0.1:5555')
    })
})
