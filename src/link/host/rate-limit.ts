/** Sliding-window counter per key. */
export class SlidingWindowLimiter {
    protected hits = new Map<string, number[]>()

    constructor(protected limit: number, protected windowMs: number) {}

    /**
     * Records one attempt.
     *
     * @returns `allowed: false` with the seconds until the oldest attempt leaves the window
     */
    hit(key: string, now: number): { allowed: true } | { allowed: false, retryAfter: number } {
        const recent = (this.hits.get(key) ?? []).filter(t => now - t < this.windowMs)
        if (recent.length >= this.limit) {
            this.hits.set(key, recent)
            return { allowed: false, retryAfter: Math.max(1, Math.ceil((recent[0] + this.windowMs - now) / 1000)) }
        }
        recent.push(now)
        this.hits.set(key, recent)
        this.prune(now)
        return { allowed: true }
    }

    reset() {
        this.hits.clear()
    }

    protected prune(now: number) {
        if (this.hits.size < 64)
            return
        for (const [key, times] of this.hits) {
            if (times.every(t => now - t >= this.windowMs))
                this.hits.delete(key)
        }
    }
}
