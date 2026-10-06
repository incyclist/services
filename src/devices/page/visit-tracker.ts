export type PairingExitVia = 'ok' | 'skip' | 'simulate' | 'cancel' | 'app_exit'
export type PreviousVisitOutcome =
    | 'none'
    | 'ready'
    | 'skip-then-ride'
    | 'skip-no-ride'
    | 'simulate'
    | 'app-exit-ready'
    | 'app-exit-not-ready'

export interface PairingVisitLast {
    visitId: string
    sessionId: string
    openedAt: number
    backgroundMs: number
    backgroundedAt?: number
    forRide: boolean
    canStartRide: boolean
    visitIndexToday: number
    firstEverVisit: boolean
    previousVisitOutcome: PreviousVisitOutcome
    previousVisitAgeMs?: number
    closed: boolean
    via?: PairingExitVia
    closedAt?: number
    rideAfter?: 'device' | 'simulate'
}

export interface PairingVisitRecord {
    date: string
    countToday: number
    firstEverPending: boolean
    last?: PairingVisitLast
}

export interface PairingVisitStore {
    get(): PairingVisitRecord | undefined
    set(record: PairingVisitRecord): void
}

export interface PairingVisitTrackerDeps {
    store: PairingVisitStore
    sessionId: string
    platform: 'desktop' | 'mobile'
    now: () => number
    today: () => string
    log: (message: string, fields: Record<string, unknown>) => void
}

export const PAGE_LEFT_EVENT = 'pairing page left'
export const VISIT_UNCLOSED_EVENT = 'pairing visit unclosed'

export const getPreviousVisitOutcome = (last: PairingVisitLast | undefined): PreviousVisitOutcome => {
    if (!last || !last.closed || !last.via) return 'none'

    switch (last.via) {
        case 'ok':
            return 'ready'
        case 'simulate':
            return 'simulate'
        case 'skip':
        case 'cancel':
            if (last.rideAfter === 'device') return 'skip-then-ride'
            if (last.rideAfter === 'simulate') return 'simulate'
            return 'skip-no-ride'
        case 'app_exit':
            return last.canStartRide ? 'app-exit-ready' : 'app-exit-not-ready'
    }
}

export class PairingVisitTracker {
    constructor(private readonly deps: PairingVisitTrackerDeps) {}

    onAppLaunch(isNewUser: boolean): void {
        const record = this.deps.store.get()
        if (!record) {
            this.deps.store.set({ date: this.deps.today(), countToday: 0, firstEverPending: isNewUser })
            return
        }

        const last = record.last
        if (!last || last.closed) return

        const now = this.deps.now()
        this.deps.log(VISIT_UNCLOSED_EVENT, {
            visitId: last.visitId,
            visitSessionId: last.sessionId,
            dwellMs: last.backgroundedAt !== undefined ? last.backgroundedAt - last.openedAt : null,
            backgroundMs: last.backgroundMs,
            forRide: last.forRide,
            canStartRide: last.canStartRide,
            visitIndexToday: last.visitIndexToday,
            firstEverVisit: last.firstEverVisit,
            visitAgeMs: now - last.openedAt,
            platform: this.deps.platform,
        })
        this.deps.store.set({
            ...record,
            last: { ...last, closed: true, via: 'app_exit', closedAt: now, backgroundedAt: undefined },
        })
    }

    openVisit({ forRide }: { forRide: boolean }): { visitId: string } {
        const now = this.deps.now()
        const today = this.deps.today()
        const previous = this.deps.store.get()

        if (previous?.last && !previous.last.closed)
            this.closeVisit('app_exit', { canStartRide: previous.last.canStartRide })

        const record = this.deps.store.get() ?? { date: today, countToday: 0, firstEverPending: false }
        const countToday = record.date === today ? record.countToday + 1 : 1
        const visitId = `${now}-${Math.random().toString(36).slice(2, 10)}`

        const prevLast = record.last
        this.deps.store.set({
            date: today,
            countToday,
            firstEverPending: false,
            last: {
                visitId,
                sessionId: this.deps.sessionId,
                openedAt: now,
                backgroundMs: 0,
                forRide,
                canStartRide: false,
                visitIndexToday: countToday,
                firstEverVisit: record.firstEverPending,
                previousVisitOutcome: getPreviousVisitOutcome(prevLast),
                previousVisitAgeMs: prevLast?.closedAt !== undefined ? now - prevLast.closedAt : undefined,
                closed: false,
            },
        })
        return { visitId }
    }

    onBackground(): void {
        const record = this.deps.store.get()
        const last = record?.last
        if (!record || !last || last.closed || last.backgroundedAt !== undefined) return
        this.deps.store.set({ ...record, last: { ...last, backgroundedAt: this.deps.now() } })
    }

    onForeground(): void {
        const record = this.deps.store.get()
        const last = record?.last
        if (!record || !last || last.closed || last.backgroundedAt === undefined) return
        const backgroundMs = last.backgroundMs + (this.deps.now() - last.backgroundedAt)
        this.deps.store.set({ ...record, last: { ...last, backgroundMs, backgroundedAt: undefined } })
    }

    closeVisit(via: PairingExitVia, { canStartRide }: { canStartRide: boolean }): void {
        const record = this.deps.store.get()
        const last = record?.last
        if (!record || !last || last.closed) return

        const now = this.deps.now()
        const backgroundMs = last.backgroundMs + (last.backgroundedAt !== undefined ? now - last.backgroundedAt : 0)

        this.deps.log(PAGE_LEFT_EVENT, {
            visitId: last.visitId,
            via,
            dwellMs: now - last.openedAt,
            backgroundMs,
            forRide: last.forRide,
            canStartRide,
            visitIndexToday: last.visitIndexToday,
            firstEverVisit: last.firstEverVisit,
            previousVisitOutcome: last.previousVisitOutcome,
            previousVisitAgeMs: last.previousVisitAgeMs,
            platform: this.deps.platform,
        })

        this.deps.store.set({
            ...record,
            last: { ...last, closed: true, via, canStartRide, backgroundMs, backgroundedAt: undefined, closedAt: now },
        })
    }

    onAppExit(canStartRide: boolean): void {
        this.closeVisit('app_exit', { canStartRide })
    }

    onRideStarted({ simulate }: { simulate: boolean }): void {
        const record = this.deps.store.get()
        const last = record?.last
        if (!record || !last || !last.closed || last.rideAfter) return
        if (last.via !== 'skip' && last.via !== 'cancel') return
        this.deps.store.set({ ...record, last: { ...last, rideAfter: simulate ? 'simulate' : 'device' } })
    }
}
