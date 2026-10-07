import { createDirectOrchestrator } from './orchestrator'

// DirectOrchestrator wraps today's DevicePairingService usage:'direct' run() loop, unchanged -
// that loop is entirely self-contained inside DevicePairingService once usage is set (see
// DesktopPairingPageService.getUsageMode()/start()), so this orchestrator has nothing to do
// itself. These tests pin down that "nothing to do" as a deliberate, safe no-op, not an
// oversight - and that it never reaches into device-list scanning, which desktop drives directly.
describe('DirectOrchestrator (desktop)', ()=> {

    test('starts in Idle/Closed, like a freshly-opened page', ()=> {
        const orchestrator = createDirectOrchestrator()

        expect(orchestrator.state).toBe('Idle')
        expect(orchestrator.selectState).toBe('Closed')
    })

    test('start() does not throw and does not change state - the run loop lives in DevicePairingService', ()=> {
        const orchestrator = createDirectOrchestrator()
        const onUpdate = jest.fn()

        expect( ()=> orchestrator.start(onUpdate)).not.toThrow()
        expect(onUpdate).not.toHaveBeenCalled()
        expect(orchestrator.state).toBe('Idle')
    })

    test('stop() does not throw', ()=> {
        const orchestrator = createDirectOrchestrator()

        expect( ()=> orchestrator.stop()).not.toThrow()
    })

    test('pause() resolves without throwing - desktop has no background/pause concept', async ()=> {
        const orchestrator = createDirectOrchestrator()

        await expect(orchestrator.pause()).resolves.toBeUndefined()
    })

    test('resume() does not throw', ()=> {
        const orchestrator = createDirectOrchestrator()

        expect( ()=> orchestrator.resume()).not.toThrow()
    })

    test('onDeviceSelectionOpened/Closed are no-ops - desktop drives the device list directly, bypassing the orchestrator', ()=> {
        const orchestrator = createDirectOrchestrator()
        const onSelectionStateChanged = jest.fn()

        expect( ()=> orchestrator.onDeviceSelectionOpened(onSelectionStateChanged)).not.toThrow()
        expect( ()=> orchestrator.onDeviceSelectionClosed()).not.toThrow()
        expect(onSelectionStateChanged).not.toHaveBeenCalled()
        expect(orchestrator.selectState).toBe('Closed')
    })

    test('each call returns a fresh orchestrator - no shared state across pages', ()=> {
        const a = createDirectOrchestrator()
        const b = createDirectOrchestrator()

        expect(a).not.toBe(b)
    })
})
