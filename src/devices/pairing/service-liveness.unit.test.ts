/* eslint-disable @typescript-eslint/no-explicit-any */
import { DevicePairingService } from './service'

// Reproduction of known defect D-1 ("all tiles stuck in WAITING").
// run() is stubbed so that these tests observe only the decisions restart() makes: whether
// it re-arms pairing or scanning, and which tiles it leaves in 'waiting'.

const createService = () => {
    const services = {
        configuration: {
            canStartRide: jest.fn().mockReturnValue(false),
            getAdapters: jest.fn().mockReturnValue([]),
        },
        access: {
            scan: jest.fn(),
            stopScan: jest.fn(),
            enrichWithAccessState: jest.fn( (i:any)=>i),
        },
        ride: {
            stop: jest.fn().mockResolvedValue(undefined),
            lazyInit: jest.fn().mockResolvedValue(true),
            waitForPreviousStartToFinish: jest.fn().mockResolvedValue(true),
            startAdapters: jest.fn(),
        },
    }
    const svc = new DevicePairingService(services as any)
    const run = jest.spyOn(svc as any, 'run').mockResolvedValue(undefined)
    const state = svc.getState() as any
    state.interfaces = []
    state.capabilities = [
        { capability:'control', connectState:'connected', selected:'udid-1', devices:[] },
        { capability:'power', connectState:'connected', selected:'udid-2', devices:[] },
        { capability:'heartrate', connectState:'waiting', devices:[] },
    ]
    return { svc, run }
}

const tilesWaiting = (svc:DevicePairingService) =>
    (svc.getState().capabilities ?? []).every( c => c.connectState==='waiting')

describe('DevicePairingService liveness', ()=> {

    beforeEach( ()=> {
        jest.useFakeTimers()
    })

    afterEach( ()=> {
        jest.useRealTimers()
        jest.clearAllMocks()
    })

    test('a single interface toggle with no recent start re-arms pairing or scanning', async ()=> {
        const { svc, run } = createService()

        const restarting = (svc as any).restart()
        await jest.advanceTimersByTimeAsync(1000)
        await restarting

        expect(run).toHaveBeenCalledTimes(1)
    })

    test('two restarts within 3 s, followed by a third, re-arm pairing or scanning', async ()=> {
        // healthy path: the sentinel is only set transiently while the restart sleeps, and
        // the restart that set it still calls run() when it completes
        const { svc, run } = createService()
        ;(svc.getState() as any).tsPrevStart = Date.now()

        const first = (svc as any).restart()
        await jest.advanceTimersByTimeAsync(4000)
        await first

        expect(run).toHaveBeenCalledTimes(1)
    })

    test('fixed D-1: after a restart that consumed the sentinel, a later restart still re-arms pairing or scanning', async ()=> {
        const { svc, run } = createService()
        ;(svc.getState() as any).tsPrevStart = Date.now()

        // the first restart sets the sentinel to -1 while it sleeps, then calls run() - which is
        // stubbed here, so it never gets the chance to replace -1 with a fresh timestamp itself
        const first = (svc as any).restart()
        await jest.advanceTimersByTimeAsync(4000)
        await first
        run.mockClear()

        // a later restart (interface toggle, tile unselect) must not find the sentinel still at -1
        const second = (svc as any).restart()
        await jest.advanceTimersByTimeAsync(4000)
        await second

        expect(run).toHaveBeenCalled()
    })

    test('fixed D-1: no tile is left waiting forever after the sentinel case', async ()=> {
        const { svc, run } = createService()
        ;(svc.getState() as any).tsPrevStart = Date.now()

        // run() is stubbed everywhere else in this file to isolate restart()'s own decisions, but
        // this test is about the tiles' end state, which only changes once run() actually executes
        // - so here it stands in for run()'s real job of taking tiles out of 'waiting'
        run.mockImplementation( async ()=> {
            (svc.getState() as any).capabilities.forEach( (c:any)=> c.connectState='connecting')
        })

        const first = (svc as any).restart()
        await jest.advanceTimersByTimeAsync(4000)
        await first

        const second = (svc as any).restart()
        await jest.advanceTimersByTimeAsync(4000)
        await second

        expect(tilesWaiting(svc)).toBe(false)
    })

    test('a restart still in its debounce sleep blocks a concurrent restart (the sentinel is not removed early)', async ()=> {
        const { svc, run } = createService()
        ;(svc.getState() as any).tsPrevStart = Date.now()

        // both start while the first is still mid-sleep - the second must bail out immediately,
        // without calling run() a second time, rather than racing it
        const first = (svc as any).restart()
        const second = (svc as any).restart()

        await jest.advanceTimersByTimeAsync(4000)
        await Promise.all([first, second])

        expect(run).toHaveBeenCalledTimes(1)
    })
})

describe('DevicePairingService pairing stalled event', ()=> {

    beforeEach( ()=> {
        jest.useFakeTimers()
    })

    afterEach( ()=> {
        jest.useRealTimers()
        jest.clearAllMocks()
    })

    // the stall condition is about selected tiles that are waiting, so mark them as such
    const createStalledService = () => {
        const created = createService()
        const caps = (created.svc.getState() as any).capabilities
        caps.filter( (c:any)=>c.selected ).forEach( (c:any)=>{ c.connectState='waiting' })
        return created
    }

    const stalledCalls = (logEvent: jest.SpyInstance) =>
        logEvent.mock.calls.filter( ([e]) => e?.message==='pairing stalled')

    test('is logged once when every selected capability stays waiting for 30 s with nothing running', async ()=> {
        const { svc } = createStalledService()
        const logEvent = jest.spyOn(svc as any, 'logEvent')

        ;(svc as any).emitStateChange()
        await jest.advanceTimersByTimeAsync(29_000)
        expect(stalledCalls(logEvent)).toHaveLength(0)

        await jest.advanceTimersByTimeAsync(1_000)
        ;(svc as any).emitStateChange()
        await jest.advanceTimersByTimeAsync(60_000)
        ;(svc as any).emitStateChange()

        expect(stalledCalls(logEvent)).toHaveLength(1)
    })

    test('the payload carries only enums, booleans and interface/capability names', async ()=> {
        const { svc } = createStalledService()
        const logEvent = jest.spyOn(svc as any, 'logEvent')

        ;(svc as any).emitStateChange()
        await jest.advanceTimersByTimeAsync(30_000)

        const [event] = stalledCalls(logEvent)[0]
        // 'ts' is added by the logger itself
        expect(Object.keys(event).sort()).toEqual(['capabilities','interfaces','isPairing','isScanning','message','sentinel','ts','usage','waiting'])
        expect(JSON.stringify(event)).not.toContain('udid-1')
        expect(event.capabilities).toEqual([
            { capability:'control', connectState:'waiting' },
            { capability:'power', connectState:'waiting' },
        ])
    })

    test('is not logged while a scan is running', async ()=> {
        const { svc } = createStalledService()
        const logEvent = jest.spyOn(svc as any, 'logEvent')
        jest.spyOn(svc as any, 'isScanning').mockReturnValue(true)

        ;(svc as any).emitStateChange()
        await jest.advanceTimersByTimeAsync(60_000)

        expect(stalledCalls(logEvent)).toHaveLength(0)
    })

    test('is not logged when no capability is selected', async ()=> {
        const { svc } = createStalledService()
        const logEvent = jest.spyOn(svc as any, 'logEvent')
        ;(svc.getState() as any).capabilities = [ { capability:'heartrate', connectState:'waiting', devices:[] } ]

        ;(svc as any).emitStateChange()
        await jest.advanceTimersByTimeAsync(60_000)

        expect(stalledCalls(logEvent)).toHaveLength(0)
    })

    test('once the once-per-start flag is cleared, a later stall is logged again', async ()=> {
        const { svc } = createStalledService()
        const logEvent = jest.spyOn(svc as any, 'logEvent')

        ;(svc as any).emitStateChange()
        await jest.advanceTimersByTimeAsync(30_000)
        ;(svc as any).stalledLogged = false
        ;(svc as any).emitStateChange()
        await jest.advanceTimersByTimeAsync(30_000)

        expect(stalledCalls(logEvent)).toHaveLength(2)
    })
})
