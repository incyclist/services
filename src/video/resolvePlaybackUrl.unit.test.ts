import { resolvePlaybackUrl } from './resolvePlaybackUrl'

describe('resolvePlaybackUrl', () => {

    test('mp4: video: -> file: (including malformed extra-slash paths)', () => {
        expect(resolvePlaybackUrl('video:///mnt/nas/video.mp4')).toBe('file:///mnt/nas/video.mp4')
        // the exact real-world case that motivated extracting this function: an extra
        // leading slash that Chromium's file: scheme tolerates but a custom video: scheme does not
        expect(resolvePlaybackUrl('video:////mnt/nas/video.mp4')).toBe('file:////mnt/nas/video.mp4')
    })

    test('mp4: file: stays file: (no video: rewrite)', () => {
        // desktop's video:// custom protocol can't serve range/seek requests for local
        // playback (FIXES_BACKLOG #83/#85) - mp4 plays via Chromium's own file: loader instead,
        // on every platform - there is no longer a desktop/mobile distinction here
        expect(resolvePlaybackUrl('file:///mnt/nas/video.mp4')).toBe('file:///mnt/nas/video.mp4')
    })

    test('avi keeps video: scheme unchanged (feeds the ffmpeg conversion pipeline)', () => {
        expect(resolvePlaybackUrl('video:///mnt/nas/video.avi')).toBe('video:///mnt/nas/video.avi')
    })

    test('incyclist: is normalized to file: first, then stays file: for mp4', () => {
        expect(resolvePlaybackUrl('incyclist:///mnt/nas/video.mp4')).toBe('file:///mnt/nas/video.mp4')
    })

    test('remote http(s) urls pass through unchanged', () => {
        expect(resolvePlaybackUrl('https://example.com/video.mp4')).toBe('https://example.com/video.mp4')
        expect(resolvePlaybackUrl('http://example.com/video.mp4')).toBe('http://example.com/video.mp4')
    })

    test('content: urls (mobile SAF) pass through unchanged', () => {
        expect(resolvePlaybackUrl('content://media/external/video/1')).toBe('content://media/external/video/1')
    })

    test('bare relative filename gets a leading ./', () => {
        expect(resolvePlaybackUrl('video.mp4')).toBe('./video.mp4')
    })

    test('undefined/empty input returns undefined', () => {
        expect(resolvePlaybackUrl(undefined)).toBeUndefined()
        expect(resolvePlaybackUrl('')).toBeUndefined()
    })
})
