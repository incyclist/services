import { LinkRecoveryGate } from './recovery'

const MIN = 60_000

describe('LinkRecoveryGate', () => {
    let gate: LinkRecoveryGate

    beforeEach(() => {
        gate = new LinkRecoveryGate()
    })

    describe('canAutoBrowse', () => {
        test('allowed before any browse', () => {
            expect(gate.canAutoBrowse(0)).toBe(true)
        })
        test('not again within 10 minutes, again after', () => {
            gate.recordBrowse(true, 1000)
            expect(gate.canAutoBrowse(1000 + 10 * MIN - 1)).toBe(false)
            expect(gate.canAutoBrowse(1000 + 10 * MIN)).toBe(true)
        })
        test('at most 3 per session', () => {
            gate.recordBrowse(true, 0)
            gate.recordBrowse(true, 11 * MIN)
            gate.recordBrowse(true, 22 * MIN)
            expect(gate.canAutoBrowse(40 * MIN)).toBe(false)
        })
        test('a manual browse starts the window but does not count', () => {
            gate.recordBrowse(false, 0)
            expect(gate.canAutoBrowse(5 * MIN)).toBe(false)
            expect(gate.canAutoBrowse(10 * MIN)).toBe(true)
            expect(gate.info(0).autoBrowsesUsed).toBe(0)
        })
    })

    describe('info', () => {
        test('reports when the next automatic browse is allowed', () => {
            gate.recordBrowse(true, 1000)
            expect(gate.info(2000)).toEqual({ autoBrowsesUsed: 1, autoBrowsesMax: 3, nextAutoBrowseAt: 1000 + 10 * MIN })
            expect(gate.info(1000 + 10 * MIN).nextAutoBrowseAt).toBeUndefined()
        })
        test('no next time once the count is used up', () => {
            gate.recordBrowse(true, 0)
            gate.recordBrowse(true, 11 * MIN)
            gate.recordBrowse(true, 22 * MIN)
            expect(gate.info(23 * MIN).nextAutoBrowseAt).toBeUndefined()
        })
    })

    describe('reset', () => {
        test('forgets everything', () => {
            gate.recordBrowse(true, 0)
            gate.reset()
            expect(gate.canAutoBrowse(1)).toBe(true)
            expect(gate.info(1).autoBrowsesUsed).toBe(0)
        })
    })
})
