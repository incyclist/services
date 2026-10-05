/**
 * Runs `fn` for every item with at most `limit` calls in flight at once, and resolves with one
 * settled result per item, in input order (same shape as Promise.allSettled).
 *
 * Used where a batch of network loads would otherwise all start together - e.g. the route
 * details of a freshly imported catalog, which on a phone can mean dozens of parallel transfers
 * over a single slow link.
 */
export const settleWithLimit = async <T, R>(
    items: Array<T>,
    limit: number,
    fn: (item: T) => Promise<R>
): Promise<Array<PromiseSettledResult<R>>> => {
    const results: Array<PromiseSettledResult<R>> = new Array(items.length)
    let next = 0

    const worker = async (): Promise<void> => {
        while (next < items.length) {
            const idx = next++
            try {
                results[idx] = { status: 'fulfilled', value: await fn(items[idx]) }
            }
            catch (reason) {
                results[idx] = { status: 'rejected', reason }
            }
        }
    }

    const workers = Math.min(Math.max(1, limit), items.length)
    await Promise.all(Array.from({ length: workers }, () => worker()))
    return results
}
