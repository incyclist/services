import { Observer, Singleton } from "../../../base/types";
import { waitNextTick } from "../../../utils";
import { WorkoutCalendarEntry } from "..";
import { IWorkoutSyncProvider, WorkoutSyncInfo } from "./types";

@Singleton
export class WorkoutSyncFactory {
    protected syncProviders: Array<WorkoutSyncInfo>
    
    constructor() {
        this.syncProviders = []
    }

    /**
     * Adds a new workout sync provider to the factory.
     * If the service already exists, its provider is replaced.
     * @param {string} service - The service of the uploader.
     * @param {IWorkoutSyncProvider} uploader - The uploader to add.
     */
    add( service:string, syncProvider: IWorkoutSyncProvider) {
        const existing = this.syncProviders.findIndex( ui=> ui.service===service)
        if (existing===-1)
            this.syncProviders.push({service,syncProvider})
        else 
            this.syncProviders[existing] = {service,syncProvider}
    }

    get(service:string):IWorkoutSyncProvider {
        const existing = this.syncProviders.findIndex( ui=> ui.service===service)
        if (existing===-1)
            return null
        else 
            return this.syncProviders[existing].syncProvider
    }


    /**
     * Performs a workout sync with all connected services or one specific service.
     */
    sync( service?:string):Observer {
        const observer = new Observer()

        const syncs:Record<string,Observer> = {}

        const providers = service ? this.syncProviders.filter(i=>i.service===service)??[] : this.syncProviders
        const target =  providers?.filter( sp=> sp.syncProvider.isConnected()) 

        if (!target?.length) {

            observer.emit('done')
            waitNextTick().then(()=>{ observer.stop()}).catch(()=>{ /* best-effort cleanup */ })
            return null
        }


        // `loaded` is emitted (with the entries and the names of the providers) as soon as at least one provider delivered
        // a full list, otherwise `done`. Changes of providers that completed their first sync earlier are signalled
        // individually (`added`, `updated`, `deleted`).
        // The entries are shared across providers, so that the result of one provider does not hide the one of another
        const workouts: Array<WorkoutCalendarEntry> = []
        const loadedServices: Array<string> = []

        target.forEach( sp=> {

            const {service,syncProvider} = sp
            const so = syncProvider.sync()

            const onDone= (event:string, entries:Array<WorkoutCalendarEntry>, service:string)=>{

                if (event==='loaded') {
                    loadedServices.push(service)
                    entries.forEach( w=> {
                        workouts.push( { ...w, source:service })
                    })

                }

                delete syncs[service]

                if (Object.keys(syncs).length===0) {

                    if ( loadedServices.length>0) {
                        observer.emit('loaded', workouts, loadedServices)

                    }
                    else {
                        observer.emit('done')
                    }

                    waitNextTick().then(()=>{ observer.stop()}).catch(()=>{ /* best-effort cleanup */ })
                }
                
            }

            syncs[service] = so
            so.on( 'added', (workout: WorkoutCalendarEntry)=> observer.emit('added', workout, service))
            so.on( 'updated', (workout: WorkoutCalendarEntry)=> observer.emit('updated', workout,service))
            so.on( 'deleted', (workout: WorkoutCalendarEntry)=> observer.emit('deleted', workout,service))
            so.once( 'done', (workouts:Array<WorkoutCalendarEntry>, service:string)=> { onDone('done',workouts,service)} )
            so.once( 'loaded', (workouts:Array<WorkoutCalendarEntry>, service:string)=> { onDone('loaded',workouts,service) })

        })
        observer.on('stop',()=>{
            Object.keys( syncs).forEach(service => {
                const so = syncs[service]
                so.emit('stop')
            })
    
        })
        return observer
    }

    async stopSync( observer:Observer) {
        observer.emit('stop')
        return new Promise(done=> {
            observer.on('done',done)
        })
    }    
    
}