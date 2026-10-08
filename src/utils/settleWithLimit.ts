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

    // each worker takes the next unclaimed item, then chains onto itself until none are left
    const worker = (): Promise<void> => {
        if (next >= items.length)
            return Promise.resolve()

        const idx = next++
        return Promise.resolve()
            .then(() => fn(items[idx]))
            .then(
                (value) => { results[idx] = { status: 'fulfilled', value } },
                (reason) => { results[idx] = { status: 'rejected', reason } }
            )
            .then(worker)
    }

    const workers = Math.min(Math.max(1, limit), items.length)
    await Promise.all(Array.from({ length: workers }, () => worker()))
    return results
}
