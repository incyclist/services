import { settleWithLimit } from './settleWithLimit'

describe('settleWithLimit', () => {

    it('never has more than the limit in flight', async () => {
        let inFlight = 0
        let maxInFlight = 0
        const fn = async (n: number) => {
            inFlight++
            maxInFlight = Math.max(maxInFlight, inFlight)
            await new Promise(r => setTimeout(r, 5))
            inFlight--
            return n
        }

        await settleWithLimit(Array.from({ length: 20 }, (_, i) => i), 4, fn)

        expect(maxInFlight).toBe(4)
    })

    it('resolves in input order, not completion order', async () => {
        const delays = [30, 5, 20, 1]
        const results = await settleWithLimit(delays, 4, async (ms) => {
            await new Promise(r => setTimeout(r, ms))
            return ms
        })

        expect(results).toEqual(delays.map(v => ({ status: 'fulfilled', value: v })))
    })

    it('captures rejections per item and keeps going', async () => {
        const error = new Error('boom')
        const results = await settleWithLimit([1, 2, 3], 2, async (n) => {
            if (n === 2) throw error
            return n
        })

        expect(results).toEqual([
            { status: 'fulfilled', value: 1 },
            { status: 'rejected', reason: error },
            { status: 'fulfilled', value: 3 },
        ])
    })

    it('handles an empty list', async () => {
        const fn = jest.fn()
        const results = await settleWithLimit([], 4, fn)

        expect(results).toEqual([])
        expect(fn).not.toHaveBeenCalled()
    })

    it('runs everything sequentially when the limit is 1', async () => {
        const order: Array<number> = []
        await settleWithLimit([1, 2, 3], 1, async (n) => {
            order.push(n)
            await new Promise(r => setTimeout(r, 1))
        })

        expect(order).toEqual([1, 2, 3])
    })
})
