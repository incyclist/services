import { IncyclistService } from "../../base/service";
import { Singleton } from "../../base/types";
import { Observer, PromiseObserver } from "../../base/types/observer";
import { ActivitiesRepository, ActivitySearchCriteria } from "../base";
import { ActivityInfo } from "../base/model";

/**
 * This service is used by the Front-End to manage and query the current and past activities
 * The service implements the business logic to display the content for 
 * - the list of activities ( incl. Search functionaly)
 * - an individual activity ( show details when finished)
 * 
 */


@Singleton
export class ActivityListService extends IncyclistService {

    protected preloadObserver: PromiseObserver<void>;
    protected initialized: boolean
    protected repo:ActivitiesRepository 
    protected observer: Observer

    constructor() {
        super('ActivityList')

        this.initialized = false;
    }

    /**
     * triggers the loading of the activities from local repo
     * 
     * This method should be called by the UI as soon as possible to reduce loading time for the user
     * 
     * @returns observer that indicates an ongoing preload
     * 
     * Besides the events signalled by the returned Observer, the following events are signalled
     * on the service observer:
     * 
     * @emits loading   list is being loaded
     * @emits loaded    loading has been completed, provides lists as parameter
     */

    preload():PromiseObserver<void> {
        try {
            if (!this.preloadObserver) {
                this.logEvent( {message:'preload activity list'})
                const promise = this.loadActivities()
                this.preloadObserver = new PromiseObserver<void>( promise )
                process.nextTick( ()=>{ if (this.observer) this.observer.emit('loading')})
    
                this.preloadObserver.start()
                    .then( ()=> { 
                        this.logEvent( {message:'preload route list completed', cnt:this.activities?.length })
                        this.initialized = true
                        this.emitLists('loaded')
                        process.nextTick( ()=>{delete this.preloadObserver})
                    })
                    .catch( (err)=> {
                        this.logError(err,'preload')
                    })
            }
            else {
                this.logEvent( {message:'waiting for current activity preload'})
            }
    
    
        }
        catch(err) {
            this.logError(err,'preload')
        }
        return this.preloadObserver
    }


    getPastActivities( filter:ActivitySearchCriteria): Array<ActivityInfo> {
        try {
            const activities  = this.getRepo().search(filter) ?? []
            return activities 
        }
        catch(err) {
            this.logError(err,'getPastActivities')
            return []
        }

    }

    async getPastActivitiesWithDetails( filter:ActivitySearchCriteria): Promise<Array<ActivityInfo>> {
        try {
            const activities  = this.getRepo().search(filter) ?? []
            const promises = []
            
            activities.forEach( ai => {
                promises.push(this.getRepo().getWithDetails(ai.summary.id))
            })
            
            await Promise.allSettled(promises)
            
            
            const res = activities.filter( a => a.details!==undefined && a.details!==null )
                    
            return res
        }
        catch(err) {
            this.logError(err,'getPastActivitiesWithDetails')
            return []
        }
    }


    protected async loadActivities():Promise<void> {

        return new Promise<void> ( done => {
            const observer = this.getRepo().load()
            //const add = this.add.bind(this)
            //const update = this.update.bind(this)
    
            //observer.on('added',add)
            //observer.on('updated',update)
            observer.on('done',done)
        })
    }


    protected getRepo():ActivitiesRepository {
        if (!this.repo)
            this.repo = new ActivitiesRepository()
        return this.repo            
    }

    protected get activities (): Array<ActivityInfo> {
        return this.getRepo().getAll()
    }

    protected getListDisplayProperties( activities:Array<ActivityInfo>) {
        // TODO
        return activities
    }

    protected emitLists( event:'loaded'|'updated') {
        try {
            const activities = this.getRepo().getAll()

            
            
            if (this.observer)
                this.observer.emit(event,this.getListDisplayProperties(activities))
    
        }
        catch(err) {
            this.logError(err,'emitLists',event)

        }
    }

}


export const useActivityList = ()=>new ActivityListService()
export const getActivityList = ()=>new ActivityListService()