import { IncyclistService } from "../../base/service";
import { Singleton } from "../../base/types";
import { Observer, PromiseObserver } from "../../base/types/observer";
import { waitNextTick } from "../../utils";
import clone from "../../utils/clone";
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
    protected filter:ActivitySearchCriteria

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

                        const getDetails = (this.getRepo().search({})??[]).filter( (a,i)=> i<20).map( a=>this.loadDetails(a))

                        Promise.allSettled(getDetails).then( ()=>{

                            this.logEvent( {message:'preload activity list completed', cnt:this.activities?.length })
                            console.log( '~~~~ ACTIVITIES', clone(this.activities) )
    
                            this.initialized = true
                            this.emitLists('loaded')
                            process.nextTick( ()=>{delete this.preloadObserver})
    
                        })
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

    openList() {
        if (!this.observer)
            this.observer = new Observer()
        return this.getListDisplayProperties()

    }

    getListObserver():Observer {
        if (!this.observer)
            this.observer = new Observer()
        return this.observer        
    }

    closeList():void {
        if (this.observer) {
            this.observer.stop()
            delete this.observer
        }

    }

    /**
     * checks if the preload is still ongoing
     * 
     * @returns true, if the preload is still ongoing, false otherwise
     */
    isStillLoading():boolean { 
        return !this.initialized 
    }

    setFilter(filter:ActivitySearchCriteria) {
        this.filter = filter
    }

    protected getPastActivities(): Array<ActivityInfo> {
        

        try {
            const activities  = this.getRepo().search(this.filter) ?? []
            return activities.sort( (a,b) => b.summary?.startTime - a.summary?.startTime )
        }
        catch(err) {
            this.logError(err,'getPastActivities')
            return []
        }

    }



    getActivityDetails(id:string): Observer {
        const observer = new Observer()
        try {
            const activity = this.getActivity(id)
            if (activity.details) {
                waitNextTick().then( () => observer.emit('loaded', activity.details) )
                return;
            }
                

            this.getRepo().getWithDetails(id).then(ai => {
                if (!ai)
                    return;
    
                if (activity) {
                    activity.details = ai.details
                }
                observer.emit('loaded', activity.details)
    
            })
            .catch(err => {
                this.logError(err,'getActivityDetails#getWithDetails')
            })
        }
        catch(err) {
            this.logError(err,'getActivityDetails')
        }
        return observer
    }

    /**
     * Deletes an activity by its ID from the local repository.
     * 
     * @param id The unique ID of the activity to be deleted.
     * 
     * @returns A promise that resolves to true if the deletion was successful, false otherwise.
     */
    async delete(id:string):Promise<boolean> {
        try {
            await this.getRepo().delete(id)
            this.emitLists('updated')
            return true

        }
        catch(err) {
            this.logError(err,'delete')
            return false
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

    protected async loadDetails(activity):Promise<void> {
        const ai = await this.getRepo().getWithDetails(activity.summary.id)
        if (!ai)
            return;

        if (activity) {
            activity.details = ai.details
        }

    }


    protected getRepo():ActivitiesRepository {
        if (!this.repo)
            this.repo = new ActivitiesRepository()
        return this.repo            
    }

    protected get activities (): Array<ActivityInfo> {
        return this.getRepo().getAll()
    }

    protected getActivity(id:string): ActivityInfo { 
        return this.activities?.find( a => a.summary.id === id)
    }


    protected getListDisplayProperties() {
        
        const activities = this.getPastActivities()
        const filter = this.filter
        return {filter,activities}
    }

    protected emitLists( event:'loaded'|'updated') {
        try {
            
            if (this.observer)
                this.observer.emit(event,this.getListDisplayProperties())
    
        }
        catch(err) {
            this.logError(err,'emitLists',{event})

        }
    }

}


export const useActivityList = ()=>new ActivityListService()
export const getActivityList = ()=>new ActivityListService()