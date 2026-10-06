import { PairingVisitRecord, PairingVisitStore, PairingVisitTracker, PAGE_LEFT_EVENT, VISIT_UNCLOSED_EVENT } from "./visit-tracker"

const DAY = 24 * 60 * 60 * 1000

class Harness {
    record: PairingVisitRecord | undefined
    logs: Array<{ message: string, fields: Record<string, unknown> }> = []
    clock = new Date(2026, 9, 6, 10, 0, 0).getTime()
    dateOverride?: string

    store: PairingVisitStore = {
        get: () => this.record ? JSON.parse(JSON.stringify(this.record)) : undefined,
        set: (r) => { this.record = JSON.parse(JSON.stringify(r)) },
    }

    tracker(sessionId = 'session-a'): PairingVisitTracker {
        return new PairingVisitTracker({
            store: this.store,
            sessionId,
            platform: 'desktop',
            now: () => this.clock,
            today: () => this.dateOverride ?? this.localDate(this.clock),
            log: (message, fields) => { this.logs.push({ message, fields }) },
        })
    }

    advance(ms: number) { this.clock += ms }

    private localDate(ts: number): string {
        const d = new Date(ts)
        const pad = (n: number) => String(n).padStart(2, '0')
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    }

    eventsNamed(name: string) { return this.logs.filter(l => l.message === name) }
}

describe('PairingVisitTracker', () => {
    describe('visit counting', () => {
        it('restarts visitIndexToday on the first open of a new local date', () => {
            const h = new Harness()
            const t = h.tracker()
            t.onAppLaunch(false)
            t.openVisit({ forRide: false })
            t.closeVisit('skip', { canStartRide: false })
            t.openVisit({ forRide: false })
            t.closeVisit('ok', { canStartRide: true })
            expect(h.record?.countToday).toBe(2)

            h.advance(DAY)
            t.openVisit({ forRide: false })
            expect(h.record?.last?.visitIndexToday).toBe(1)
        })
    })

    describe('exit logging', () => {
        it('logs pairing page left with the exit fields and no identifiers beyond visitId', () => {
            const h = new Harness()
            const t = h.tracker()
            t.onAppLaunch(false)
            t.openVisit({ forRide: false })
            h.advance(10_000)
            t.closeVisit('skip', { canStartRide: false })

            const [event] = h.eventsNamed(PAGE_LEFT_EVENT)
            expect(event.fields).toEqual({
                visitId: expect.any(String),
                via: 'skip',
                dwellMs: 10_000,
                backgroundMs: 0,
                forRide: false,
                canStartRide: false,
                visitIndexToday: 1,
                firstEverVisit: false,
                previousVisitOutcome: 'none',
                previousVisitAgeMs: undefined,
                platform: 'desktop',
            })
        })

        it('emits exactly one terminal event when app exit is followed by close and unmount', () => {
            const h = new Harness()
            const t = h.tracker()
            t.onAppLaunch(false)
            t.openVisit({ forRide: false })
            t.onAppExit(true)
            t.closeVisit('skip', { canStartRide: true })
            t.closeVisit('ok', { canStartRide: true })

            const left = h.eventsNamed(PAGE_LEFT_EVENT)
            expect(left).toHaveLength(1)
            expect(left[0].fields.via).toBe('app_exit')
        })

        it('does not emit an unclosed event for a visit that was closed', () => {
            const h = new Harness()
            const t = h.tracker()
            t.onAppLaunch(false)
            t.openVisit({ forRide: false })
            t.closeVisit('ok', { canStartRide: true })

            h.advance(5_000)
            h.tracker('session-b').onAppLaunch(false)
            expect(h.eventsNamed(VISIT_UNCLOSED_EVENT)).toHaveLength(0)
        })

        it('reports a visit killed on the Pairing page once at the next launch, in the relaunch session', () => {
            const h = new Harness()
            const first = h.tracker('session-a')
            first.onAppLaunch(false)
            first.openVisit({ forRide: true })
            h.advance(30_000)
            first.onBackground()
            h.advance(4_000)

            const relaunch = h.tracker('session-b')
            relaunch.onAppLaunch(false)
            relaunch.onAppLaunch(false)

            const unclosed = h.eventsNamed(VISIT_UNCLOSED_EVENT)
            expect(unclosed).toHaveLength(1)
            expect(unclosed[0].fields).toEqual({
                visitId: expect.any(String),
                visitSessionId: 'session-a',
                dwellMs: 30_000,
                backgroundMs: 0,
                forRide: true,
                canStartRide: false,
                visitIndexToday: 1,
                firstEverVisit: false,
                visitAgeMs: 34_000,
                platform: 'desktop',
            })
            expect(h.record?.last?.via).toBe('app_exit')
        })

        it('an unclosed visit that was never backgrounded has null dwellMs', () => {
            const h = new Harness()
            h.tracker('session-a').onAppLaunch(false)
            h.tracker('session-a').openVisit({ forRide: false })
            h.advance(7_000)
            h.tracker('session-b').onAppLaunch(false)
            expect(h.eventsNamed(VISIT_UNCLOSED_EVENT)[0].fields.dwellMs).toBeNull()
        })
    })

    describe('background time', () => {
        it('sums backgroundMs over several background and foreground cycles', () => {
            const h = new Harness()
            const t = h.tracker()
            t.onAppLaunch(false)
            t.openVisit({ forRide: false })
            h.advance(2_000)
            t.onBackground()
            h.advance(20_000)
            t.onForeground()
            h.advance(1_000)
            t.onBackground()
            h.advance(5_000)
            t.onForeground()
            h.advance(3_000)
            t.closeVisit('skip', { canStartRide: false })

            const [event] = h.eventsNamed(PAGE_LEFT_EVENT)
            expect(event.fields.backgroundMs).toBe(25_000)
            expect(event.fields.dwellMs).toBe(31_000)
        })

        it('counts a visit still backgrounded at exit', () => {
            const h = new Harness()
            const t = h.tracker()
            t.onAppLaunch(false)
            t.openVisit({ forRide: false })
            t.onBackground()
            h.advance(8_000)
            t.onAppExit(false)
            expect(h.eventsNamed(PAGE_LEFT_EVENT)[0].fields.backgroundMs).toBe(8_000)
        })
    })

    describe('previousVisitOutcome', () => {
        const runPrevious = (setup: (t: PairingVisitTracker, h: Harness) => void): string => {
            const h = new Harness()
            const t = h.tracker()
            t.onAppLaunch(false)
            setup(t, h)
            t.openVisit({ forRide: false })
            return h.record?.last?.previousVisitOutcome as string
        }

        it('none when no visit was recorded', () => {
            expect(runPrevious(() => {})).toBe('none')
        })

        it('ready after ok', () => {
            expect(runPrevious(t => { t.openVisit({ forRide: false }); t.closeVisit('ok', { canStartRide: true }) })).toBe('ready')
        })

        it('skip-no-ride after skip without a ride', () => {
            expect(runPrevious(t => { t.openVisit({ forRide: false }); t.closeVisit('skip', { canStartRide: false }) })).toBe('skip-no-ride')
        })

        it('skip-then-ride after skip followed by a device ride', () => {
            expect(runPrevious((t, h) => {
                t.openVisit({ forRide: false }); t.closeVisit('cancel', { canStartRide: false })
                t.onRideStarted({ simulate: false })
            })).toBe('skip-then-ride')
        })

        it('simulate after skip followed by a simulated ride', () => {
            expect(runPrevious(t => {
                t.openVisit({ forRide: false }); t.closeVisit('skip', { canStartRide: false })
                t.onRideStarted({ simulate: true })
            })).toBe('simulate')
        })

        it('simulate after an explicit simulate exit', () => {
            expect(runPrevious(t => { t.openVisit({ forRide: false }); t.closeVisit('simulate', { canStartRide: false }) })).toBe('simulate')
        })

        it('app-exit-ready and app-exit-not-ready follow the last canStartRide', () => {
            expect(runPrevious(t => { t.openVisit({ forRide: false }); t.onAppExit(true) })).toBe('app-exit-ready')
            expect(runPrevious(t => { t.openVisit({ forRide: false }); t.onAppExit(false) })).toBe('app-exit-not-ready')
        })

        it('records only the first ride after a non-OK exit', () => {
            const h = new Harness()
            const t = h.tracker()
            t.onAppLaunch(false)
            t.openVisit({ forRide: false })
            t.closeVisit('skip', { canStartRide: false })
            t.onRideStarted({ simulate: false })
            t.onRideStarted({ simulate: true })
            expect(h.record?.last?.rideAfter).toBe('device')
        })

        it('a ride after an ok exit is ignored', () => {
            const h = new Harness()
            const t = h.tracker()
            t.onAppLaunch(false)
            t.openVisit({ forRide: false })
            t.closeVisit('ok', { canStartRide: true })
            t.onRideStarted({ simulate: false })
            expect(h.record?.last?.rideAfter).toBeUndefined()
        })
    })

    describe('firstEverVisit', () => {
        it('is true for a fresh install that opens Pairing', () => {
            const h = new Harness()
            const t = h.tracker()
            t.onAppLaunch(true)
            t.openVisit({ forRide: false })
            expect(h.record?.last?.firstEverVisit).toBe(true)
        })

        it('is false on the second visit of a fresh install', () => {
            const h = new Harness()
            const t = h.tracker()
            t.onAppLaunch(true)
            t.openVisit({ forRide: false })
            t.closeVisit('ok', { canStartRide: true })
            t.openVisit({ forRide: false })
            expect(h.record?.last?.firstEverVisit).toBe(false)
        })

        it('is false for an upgraded install with no record', () => {
            const h = new Harness()
            const t = h.tracker()
            t.onAppLaunch(false)
            t.openVisit({ forRide: false })
            expect(h.record?.last?.firstEverVisit).toBe(false)
        })

        it('survives a new install that quits before reaching Pairing', () => {
            const h = new Harness()
            h.tracker('session-a').onAppLaunch(true)
            h.tracker('session-b').onAppLaunch(false)
            h.tracker('session-b').openVisit({ forRide: false })
            expect(h.record?.last?.firstEverVisit).toBe(true)
        })
    })

    describe('event fields', () => {
        it('contains only enums, booleans, counters, durations and ids', () => {
            const h = new Harness()
            const t = h.tracker()
            t.onAppLaunch(false)
            t.openVisit({ forRide: false })
            t.closeVisit('ok', { canStartRide: true })
            for (const event of [...h.eventsNamed(PAGE_LEFT_EVENT)])
                for (const value of Object.values(event.fields))
                    expect(['string', 'number', 'boolean', 'undefined']).toContain(typeof value)
        })
    })
})
