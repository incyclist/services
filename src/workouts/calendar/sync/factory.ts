import { Observer, Singleton } from "../../../base/types";
import { waitNextTick } from "../../../utils";
import { WorkoutCalendarEntry } from "..";
import { IWorkoutSyncProvider, WorkoutSyncInfo } from "./types";

/**
 * Registry and coordinator for workout calendar sync providers.
 *
 * Each integration (e.g. Intervals.icu) registers an {@link IWorkoutSyncProvider}
 * under a unique service name.  {@link sync} then fans out to all connected
 * providers, aggregates their results, and relays incremental change events
 * (`added`, `updated`, `deleted`) to a single returned {@link Observer}.
 *
 * Implemented as a `@Singleton` — `new WorkoutSyncFactory()` always returns
 * the same instance.  Call `instance.reset()` (injected by the decorator) to
 * destroy the singleton so the next construction creates a fresh one.
 */
@Singleton
export class WorkoutSyncFactory {
    protected syncProviders: Array<WorkoutSyncInfo>

    constructor() {
        this.syncProviders = []
    }

    /**
     * Registers a workout sync provider under the given service name.
     *
     * If a provider is already registered for `service`, it is replaced.
     *
     * @param service - Unique service identifier (e.g. `'intervals'`).
     * @param syncProvider - The provider to register.
     */
    add( service:string, syncProvider: IWorkoutSyncProvider) {
        const existing = this.syncProviders.findIndex( ui=> ui.service===service)
        if (existing===-1)
            this.syncProviders.push({service,syncProvider})
        else 
            this.syncProviders[existing] = {service,syncProvider}
    }

    /**
     * Returns the registered provider for the given service name.
     *
     * @param service - Service identifier to look up.
     * @returns The provider, or `null` if no provider is registered under that name.
     */
    get(service:string):IWorkoutSyncProvider {
        const existing = this.syncProviders.findIndex( ui=> ui.service===service)
        if (existing===-1)
            return null
        else
            return this.syncProviders[existing].syncProvider
    }


    /**
     * Starts a calendar sync across all registered (and connected) providers,
     * or only the provider for the named service if `service` is given.
     *
     * Returns `null` when there are no connected providers to sync — a `done`
     * event is still emitted internally but there is no observer to attach to.
     *
     * **Events emitted on the returned observer:**
     * - `loaded` `(workouts: WorkoutCalendarEntry[])` – all providers have
     *   completed their first sync; workouts are merged and each entry has
     *   a `source` field set to the originating service name.
     * - `done` – all providers have completed a subsequent sync.
     * - `added` `(workout: WorkoutCalendarEntry, service: string)` – relayed
     *   from an individual provider.
     * - `updated` `(workout: WorkoutCalendarEntry, service: string)` – relayed
     *   from an individual provider.
     * - `deleted` `(workout: WorkoutCalendarEntry, service: string)` – relayed
     *   from an individual provider.
     *
     * Emit `stop` on the returned observer to cancel all in-flight syncs.
     *
     * @param service - Optional service name to restrict the sync to a single provider.
     * @returns An aggregating observer, or `null` when no connected provider is available.
     */
    sync( service?:string):Observer {
        const observer = new Observer()

        const syncs:Record<string,Observer> = {}

        const providers = service ? this.syncProviders.filter(i=>i.service===service)??[] : this.syncProviders
        const target =  providers?.filter( sp=> sp.syncProvider.isConnected()) 

        if (!target?.length) {

            observer.emit('done')
            waitNextTick().then(()=>{ observer.stop()})
            return null
        }


        target.forEach( sp=> {

            const workouts: Array<WorkoutCalendarEntry> = []

            const {service,syncProvider} = sp
            const so = syncProvider.sync()

            const onDone= (event:string, entries:Array<WorkoutCalendarEntry>, service:string)=>{ 

                if (event==='loaded') {
                    entries.forEach( w=> { 
                        workouts.push( { ...w, source:service }) 
                    })
                    
                }

                delete syncs[service]

                if (Object.keys(syncs).length===0) {

                    if ( event==='loaded') {
                        observer.emit('loaded', workouts)

                    }
                    else {
                        observer.emit('done')
                    }

                    waitNextTick().then(()=>{ observer.stop()})
                }
                
            }

            syncs[service] = so
            so.on( 'added', (workout: WorkoutCalendarEntry)=> observer.emit('added', workout, service))
            so.on( 'updated', (workout: WorkoutCalendarEntry)=> observer.emit('updated', workout,service))
            so.on( 'deleted', (workout: WorkoutCalendarEntry)=> observer.emit('deleted', workout,service))
            so.once( 'done', (workouts:Array<WorkoutCalendarEntry>, service:string)=> { onDone('done',workouts,service)} )
            so.once( 'loaded', (workouts:Array<WorkoutCalendarEntry>, service:string)=> { onDone('loaded',workouts,service) })

        })
        observer.on('stop',async ()=>{
            Object.keys( syncs).forEach(service => {
                const so = syncs[service]
                so.emit('stop')
            })
            await waitNextTick()
            observer.emit('done')
    
        })
        return observer
    }

    /**
     * Requests cancellation of a running sync and waits until it acknowledges
     * the stop by emitting `done`.
     *
     * @param observer - The observer previously returned by {@link sync}.
     * @returns Resolves once the observer emits `done`.
     */
    async stopSync( observer:Observer) {
        observer.emit('stop')
        return new Promise(done=> {
            observer.on('done',done)
        })
    }

}