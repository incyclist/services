import { EventLogger } from 'gd-eventlog'
import { getBindings } from '../../api'
import { useAppState } from '../../appstate'
import {
    createPairingVisitStore, formatLocalDate, initPairingVisitTracker, PAIRING_VISITS_STATE_KEY,
    toVisitPlatform, usePairingVisitTracker
} from './visit-log-factory'
import { PAGE_LEFT_EVENT } from './visit-log'

jest.mock('../../api', () => ({ getBindings: jest.fn() }))
jest.mock('../../appstate', () => ({ useAppState: jest.fn() }))

const createAppState = () => {
    const values: Record<string, any> = {}
    return {
        values,
        getPersistedState: jest.fn((key: string) => values[key]),
        setPersistedState: jest.fn((key: string, value: any) => { values[key] = value }),
    }
}

describe('pairing visit tracker factory', () => {
    let appState: ReturnType<typeof createAppState>

    beforeEach(() => {
        appState = createAppState()
        ;(useAppState as jest.Mock).mockReturnValue(appState)
        ;(getBindings as jest.Mock).mockReturnValue({ appInfo: { session: 'session-1', getChannel: () => 'mobile' } })
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    describe('store', () => {
        it('reads and writes the record under the pairingVisits persisted state key', () => {
            const store = createPairingVisitStore(appState)
            const record = { date: '2026-10-06', countToday: 0, firstEverPending: true }
            store.set(record)
            expect(appState.setPersistedState).toHaveBeenCalledWith(PAIRING_VISITS_STATE_KEY, record)
            expect(store.get()).toEqual(record)
            expect(PAIRING_VISITS_STATE_KEY).toBe('pairingVisits')
        })

        it('returns undefined when nothing was stored yet', () => {
            expect(createPairingVisitStore(appState).get()).toBeUndefined()
        })

        it('treats a stored null as no record', () => {
            appState.values[PAIRING_VISITS_STATE_KEY] = null
            expect(createPairingVisitStore(appState).get()).toBeUndefined()
        })
    })

    it('formats the local date as YYYY-MM-DD', () => {
        expect(formatLocalDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
        expect(formatLocalDate(new Date(2026, 11, 31, 0, 1))).toBe('2026-12-31')
    })

    it.each([
        ['mobile', 'mobile'],
        ['mobile/webview', 'mobile'],
        ['desktop', 'desktop'],
        ['web', 'desktop'],
        [undefined, 'desktop'],
    ])('maps platform %s to %s', (platform, expected) => {
        expect(toVisitPlatform(platform)).toBe(expected)
    })

    it('builds a tracker that logs with the app session, platform and persisted state', () => {
        const logSpy = jest.spyOn(EventLogger.prototype, 'logEvent').mockImplementation(() => undefined)
        const tracker = initPairingVisitTracker('desktop')
        tracker.onAppLaunch(false)
        tracker.openVisit({ forRide: false })
        tracker.closeVisit('skip', { canStartRide: false })

        const stored = appState.values[PAIRING_VISITS_STATE_KEY]
        expect(stored.last.sessionId).toBe('session-1')
        expect(stored.date).toBe(formatLocalDate(new Date()))
        expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
            message: PAGE_LEFT_EVENT, via: 'skip', platform: 'desktop'
        }))
    })

    it('usePairingVisitTracker returns the tracker built at launch', () => {
        const tracker = initPairingVisitTracker('mobile')
        expect(usePairingVisitTracker()).toBe(tracker)
        expect(usePairingVisitTracker()).toBe(tracker)
    })
})

describe('usePairingVisitTracker before launch', () => {
    it('falls back to the app channel for the platform', () => {
        jest.isolateModules(() => {
            const appState = createAppState()
            ;(require('../../appstate').useAppState as jest.Mock).mockReturnValue(appState)
            ;(require('../../api').getBindings as jest.Mock).mockReturnValue({ appInfo: { session: 's', getChannel: () => 'mobile' } })
            const { usePairingVisitTracker: use } = require('./visit-log-factory')
            const tracker = use()
            expect((tracker as any).deps.platform).toBe('mobile')
            expect(use()).toBe(tracker)
        })
    })
})
