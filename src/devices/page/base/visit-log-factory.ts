import { EventLogger } from 'gd-eventlog'
import { getBindings } from '../../../api'
import { useAppState } from '../../../appstate'
import { PairingVisitTracker } from './visit-log'
import type { PairingVisitRecord, PairingVisitStore, PairingVisitTrackerDeps } from './types'

export const PAIRING_VISITS_STATE_KEY = 'pairingVisits'

type PersistedStateAccess = {
    getPersistedState(key: string): any
    setPersistedState(key: string, value: any): void
}

let instance: PairingVisitTracker | undefined
let logger: EventLogger | undefined

export const createPairingVisitStore = (appState: PersistedStateAccess): PairingVisitStore => ({
    get: (): PairingVisitRecord | undefined => appState.getPersistedState(PAIRING_VISITS_STATE_KEY) ?? undefined,
    set: (record: PairingVisitRecord): void => { appState.setPersistedState(PAIRING_VISITS_STATE_KEY, record) },
})

export const formatLocalDate = (date: Date): string => {
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export const toVisitPlatform = (platform: string | undefined): PairingVisitTrackerDeps['platform'] =>
    platform?.startsWith('mobile') ? 'mobile' : 'desktop'

const log = (message: string, fields: Record<string, unknown>): void => {
    logger = logger ?? new EventLogger('Pairing')
    logger.logEvent({ message, ...fields })
}

export const initPairingVisitTracker = (platform?: string): PairingVisitTracker => {
    const appInfo = getBindings()?.appInfo
    instance = new PairingVisitTracker({
        store: createPairingVisitStore(useAppState()),
        sessionId: appInfo?.session ?? '',
        platform: toVisitPlatform(platform ?? appInfo?.getChannel()),
        now: () => Date.now(),
        today: () => formatLocalDate(new Date()),
        log,
    })
    return instance
}

export const usePairingVisitTracker = (): PairingVisitTracker => instance ?? initPairingVisitTracker()
