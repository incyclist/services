import { resolvePlaybackUrl } from './resolvePlaybackUrl'

describe('resolvePlaybackUrl', () => {

    test('desktop, mp4: video: -> file: (including malformed extra-slash paths)', () => {
        expect(resolvePlaybackUrl('video:///mnt/nas/video.mp4', false)).toBe('file:///mnt/nas/video.mp4')
        // the exact real-world case that motivated extracting this function: an extra
        // leading slash that Chromium's file: scheme tolerates but a custom video: scheme does not
        expect(resolvePlaybackUrl('video:////mnt/nas/video.mp4', false)).toBe('file:////mnt/nas/video.mp4')
    })

    test('desktop, mp4: file: -> video:', () => {
        expect(resolvePlaybackUrl('file:///mnt/nas/video.mp4', false)).toBe('video:///mnt/nas/video.mp4')
    })

    test('mobile, mp4: file: stays file: (no video: rewrite)', () => {
        expect(resolvePlaybackUrl('file:///mnt/nas/video.mp4', true)).toBe('file:///mnt/nas/video.mp4')
    })

    test('avi keeps video: scheme unchanged (feeds the ffmpeg conversion pipeline)', () => {
        expect(resolvePlaybackUrl('video:///mnt/nas/video.avi', false)).toBe('video:///mnt/nas/video.avi')
    })

    test('incyclist: is normalized to file: first, then follows the same mp4 rewrite rules', () => {
        expect(resolvePlaybackUrl('incyclist:///mnt/nas/video.mp4', false)).toBe('video:///mnt/nas/video.mp4')
    })

    test('remote http(s) urls pass through unchanged', () => {
        expect(resolvePlaybackUrl('https://example.com/video.mp4', false)).toBe('https://example.com/video.mp4')
        expect(resolvePlaybackUrl('http://example.com/video.mp4', false)).toBe('http://example.com/video.mp4')
    })

    test('content: urls (mobile SAF) pass through unchanged', () => {
        expect(resolvePlaybackUrl('content://media/external/video/1', false)).toBe('content://media/external/video/1')
    })

    test('bare relative filename gets a leading ./', () => {
        expect(resolvePlaybackUrl('video.mp4', false)).toBe('./video.mp4')
    })

    test('undefined/empty input returns undefined', () => {
        expect(resolvePlaybackUrl(undefined, false)).toBeUndefined()
        expect(resolvePlaybackUrl('', false)).toBeUndefined()
    })
})
