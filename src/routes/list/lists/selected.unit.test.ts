import { useUserSettings } from '../../../settings'
import { score } from './selected'

describe('score', () => {

    let settings

    beforeAll(() => {
        settings = useUserSettings()
        settings.set = jest.fn()
    })

    afterAll(() => {
        settings.reset()
    })

    test('a recently imported local route scores higher than a stale one', () => {
        const now = Date.now()
        settings.get = jest.fn(() => ({}))

        const recent = score({ isLocal: true, tsImported: now }, 0)
        const stale = score({ isLocal: true, tsImported: now - 1000 * 3600 * 24 * 30 }, 0)

        expect(recent).toBeGreaterThan(stale)
    })

    test('a video route scores higher than an otherwise identical GPX route', () => {
        settings.get = jest.fn(() => ({}))

        const video = score({ hasVideo: true }, 0)
        const gpx = score({ hasVideo: false }, 0)

        expect(video).toBeGreaterThan(gpx)
    })

    test('a new route scores higher than an otherwise identical route that is not new', () => {
        const now = Date.now()
        const initial = now - 1000 * 3600 * 24 * 10
        const prev = now - 1000 * 3600 * 24 * 5
        settings.get = jest.fn(() => ({ initial, prev }))

        const isNew = score({ isLocal: false, tsImported: now - 60_000 }, 0)
        const notNew = score({ isLocal: false, tsImported: now - 1000 * 3600 * 24 * 20 }, 0)

        expect(isNew).toBeGreaterThan(notNew)
    })

    test('an earlier position in the source list nudges the score up', () => {
        settings.get = jest.fn(() => ({}))

        const descr = { isLocal: true, tsImported: Date.now() - 1000 * 3600 * 24 * 30 }

        expect(score(descr, 0)).toBeGreaterThan(score(descr, 500))
    })
})
