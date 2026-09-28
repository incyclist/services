/**
 * Bounds and de-duplicates the calls that load a route's details for a list row or tile.
 *
 * Without this, every row/tile that enters the visible window fires its own load with no cap - a
 * fast scroll (or the first pass over a large library) can put dozens of them in flight at once.
 * A tile also shows two sides of the same route at the same time, so without de-duplication a
 * single visible tile already fires two independent loads for the same route id.
 *
 * A request for an id that already has a queued or in-flight job shares that job - the loader is
 * called once, and every caller's callback is invoked with its result.
 *
 * `request()` returns a cancel function. Call it when the caller loses interest (the row left the
 * visible window, or the component was removed) - if the job has not started yet and no other
 * caller is still interested, it is removed from the queue and never consumes a concurrency slot.
 * A job that has already started cannot be aborted (the underlying load has no cancellation), so
 * it runs to completion; if nobody is listening any more its result is simply discarded.
 */

/**
 * Max number of concurrent loads across all rows/tiles.
 *
 * Chosen small on purpose: this bounds main-thread/IPC work during a fast scroll or the first
 * pass over a pre-existing library (before shapes are backfilled), not steady-state throughput -
 * the visible window itself is only ~15-30 rows. Low enough that a burst of new rows cannot
 * stampede the loader, high enough that the queue still drains within a scroll gesture rather
 * than visibly trailing it.
 */
const ROUTE_DETAILS_CONCURRENCY = 4

type Job<T> = { id:string, listeners:Set<(details?:T)=>void>, started:boolean }

export class RouteDetailsQueue<T> {

    protected active = 0
    protected pending:Array<Job<T>> = []            // jobs waiting for a concurrency slot, in request order
    protected jobs = new Map<string,Job<T>>()       // id -> job, whether queued or in flight

    /**
     * @param load          loads the details of one route
     * @param maxConcurrent max number of loads running at once
     */
    constructor(protected load:(id:string)=>Promise<T>, protected maxConcurrent = ROUTE_DETAILS_CONCURRENCY) {
    }

    /**
     * Requests a route's details, sharing an existing queued/in-flight job for the same id.
     *
     * @param id        route id
     * @param onResult  called with the loaded details (or `undefined` on failure), unless the
     *                  caller has cancelled by then
     * @returns a cancel function
     */
    request(id:string, onResult:(details?:T)=>void):()=>void {
        if (!id || typeof this.load!=='function' || typeof onResult!=='function')
            return () => {}

        let job = this.jobs.get(id)
        if (!job) {
            job = { id, listeners: new Set(), started: false }
            this.jobs.set(id, job)
            this.pending.push(job)
        }
        job.listeners.add(onResult)

        this.drain()

        const queued = job
        return () => {
            queued.listeners.delete(onResult)
            if (!queued.started && queued.listeners.size===0) {
                const idx = this.pending.indexOf(queued)
                if (idx>=0)
                    this.pending.splice(idx,1)
                if (this.jobs.get(id)===queued)
                    this.jobs.delete(id)
            }
        }
    }

    protected drain():void {
        while (this.active<this.maxConcurrent && this.pending.length>0) {
            const job = this.pending.shift()

            // cancelled while queued - nobody left to deliver to, skip without consuming a slot
            if (job.listeners.size===0) {
                if (this.jobs.get(job.id)===job)
                    this.jobs.delete(job.id)
                continue
            }

            job.started = true
            this.active++

            this.load(job.id)
                .then( details => {
                    job.listeners.forEach( cb => {
                        try { cb(details) }
                        catch { /* a listener's own handling is its own responsibility */ }
                    })
                })
                .catch( ()=> {
                    // consumers render without map/elevation on failure
                    job.listeners.forEach( cb => {
                        try { cb(undefined) }
                        catch { /* a listener's own handling is its own responsibility */ }
                    })
                })
                .finally( ()=> {
                    this.active--
                    if (this.jobs.get(job.id)===job)
                        this.jobs.delete(job.id)
                    this.drain()
                })
        }
    }
}
