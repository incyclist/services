import { Injectable } from "../../base/decorators/Injection";
import { IncyclistService } from "../../base/service";
import { Singleton } from "../../base/types";
import { Observer, PromiseObserver } from "../../base/types/observer";
import { RouteCard } from "../../routes/list/cards/RouteCard";
import { waitNextTick } from "../../utils";
import { ActivitiesRepository, Activity, ActivitySearchCriteria } from "../base";
import { ActivityInfo } from "../base/model";
import { ActivityUploadFactory } from "../upload";
import { ActivityErrorDisplayProperties, ActivityListDisplayProperties, RideAgainResponse, SelectedActivityDisplayProperties, SelectedActivityResponse } from "./types";

/**
 * This service is used by the Front-End to manage and query the current and past activities
 * 
 * The service implements the business logic to display the content for 
 * - the list of activities ( incl. Search functionaly)
 * - an individual activity ( show details when finished)
 * 
 * @example
 * // start thee process to show the list of activities
 * const service = useActivityList();
 *
 * useEffect(() => {
 *    .... // ensure this is only called once 
 *    const displayProps = service.openList()
 *    setState(displayProps)
 *    setLoading(false)
 *    observerRef.current = service.getListObserver()        
 *    observerRef.current.on('updated',(update) => setState(update))
 * },[service])
 * 
 * 
 * 
 * @class
 * @public 
 */


@Singleton
export class ActivityListService extends IncyclistService {

    protected initialized: boolean
    protected repo:ActivitiesRepository 

    protected observers:Record<string,Observer>={}
    protected filter:ActivitySearchCriteria

    protected selected:Activity
    protected listTop:number
    protected opened?:'list'|'selected'

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

    preload(props?:{cntDetails?:number}):PromiseObserver<void> {

        let preloadObserver:PromiseObserver<void> = this.getPreloadObserver()
        try {
            // avoid parallel preloads
            if (!preloadObserver) {
                this.logEvent( {message:'preload activity list'})

                // load the summary records
                const promise = this.loadActivities()
                preloadObserver = this.observers.preload = new PromiseObserver<void>( promise )
                if (this.getListObserver()) 
                    this.getListObserver().emit('loading')
    
                preloadObserver.start()
                    .then( ()=> { 
                        // load the required detail records and inform the UI
                        this.preloadDetails(props?.cntDetails).then( ()=>{

                            this.logEvent( {message:'preload activity list completed', cnt:this.activities?.length })
                            
                            this.initialized = true
                            this.emitLists('loaded')
                                                        
                            process.nextTick( ()=>{delete this.observers.preload})
    
                        })
                    })
                    .catch( (err)=> {
                        this.logError(err,'preload')

                        this.initialized = false
                        process.nextTick( ()=>{delete this.observers.preload})
                    })
            }
            else {
                this.logEvent( {message:'waiting for current activity preload'})
            }
    
    
        }
        
        catch(err) /* istanbul ignore next */ {
            this.logError(err,'preload')
        }
        return preloadObserver
    }

    /**
     * Opens the activity list and returns the properties to be used for the ActivityList component
     * 
     * This method initializes an observer (if it doesn't already exist) which can be used to 
     * notify the UI about relevant changes in the list, which might require a (partial) re-render
     * 
     * @returns {ActivityListDisplayProperties} The display properties of the activity list.
     */
    openList():ActivityListDisplayProperties {

        this.opened = 'list'

        // ensure that the observer exists or is created
        this.getObserver()

        if (!this.initialized)
            this.preload()
        
        return this.getListDisplayProperties()

    }

    /**
     * Stores the current top position of the ActivityList in the list component
     * 
     * This value is used to restore the position when the ActivityList is re-opened
     * 
     * @param top the current top position of the first item in the list
     */
    setListTop(top:number) {
        this.listTop = top
    }

    /**
     * returns the current top position of the first item in the list
     * 
     * @returns the top position of the first item in the list
     */
    getListTop() {
        return this.listTop
    }

    /**
     * returns an observer that is used to inform the UI about relevant changes
     * 
     * @returns an observer that emits the following events
     * 
     * @emits started   observer just has been created
     * @emits loading   list is being loaded
     * @emits loaded    loading has been completed, provides lists as parameter
     * @emits updated   lists have been updated, provides lists as first parameter, provides a hash as 2nd paramter (allows UI to only refresh if hash has changed)
     */
    getObserver():Observer {
        const uiElement = this.opened
        
        if (!this.observers[uiElement])
            this.observers[uiElement] = new Observer()
            
        return this.observers[uiElement]
    }

    /**
     * Cleans up the list observer by stopping it and removing the listeners
     * 
     * This method should be called when the activity list is no longer needed 
     * to ensure proper resource management.
     */
    closeList():void {
        if (this.getListObserver()) {
            this.getListObserver().stop()
            delete this.observers.list
        }
        delete this.listTop
        delete this.opened
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


    /**
     * should be called to retrieve the details of an activity. Returns an observer that is used to signal changes to the UI.
     * 
     * @param id the id of the activity
     * 
     * @returns an observer that emits the following events
     * 
     * @emits loaded    the activity details have been loaded, provides the details as parameter
     * @emits load-error an error has occurred while loading the details, provides the error message as parameter
     */
    getActivityDetails(id:string): Observer {
        const observer = new Observer()
        try {
            const activity = this.getActivity(id)
            if (activity.details) {
                waitNextTick().then( () => observer.emit('loaded', activity.details) )
                return observer;
            }
                

            this.getRepo().getWithDetails(id).then(ai => {
                // istanbul ignore if
                if (!ai)
                    return;
    
                if (activity) {
                    activity.details = ai.details
                }
                observer.emit('loaded', activity.details)
    
            })
            .catch(err => {
                observer.emit('load-error', err.message)
                this.logError(err,'getActivityDetails#getWithDetails')
            })
        }
        catch(err) /* istanbul ignore next */ {
            this.logError(err,'getActivityDetails')
        }
        return observer
    }

    /**
     * Deletes an activity by its ID from the local repository.
     * 
     * @param id The unique ID of the activity to be deleted.
     * 
     * @emits updated  deletion has been completed, provides updated display properties

     * @returns A promise that resolves to true if the deletion was successful, false otherwise.
     * 
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

    /**
     * Is used by the UI to mark and activity as selected 
     * 
     * If the activity is not complete yet (i.e. its details are not available yet), it will load the details from repo.
     * 
     * @param id The unique ID of the activity to be selected.
     * 
     * @returns true if the activity has been selected, false otherwise.
     **/
    select (id:string):boolean {
        const selected = this.getActivity(id)

        if (selected) {
            this.selected = new Activity(selected)
            if (!this.selected.isComplete() && !this.selected.isLoading()) {
                const observer = new PromiseObserver<void>(this.loadDetails(this.selected))
                this.selected.setLoading(observer)
            }            
            return true
        }
        return false
    }

    /**
     * @returns the currently selected activity. If no activity is selected, it returns undefined.
     * 
     */
    getSelected():Activity {
        return this.selected        
    }

    /**
     * Retrieves the properties to be rendered when showing the currently selected activity.
     * in the ActivityDetails dialog
     * 
     * If no activity is selected, it returns an object with title and error properties.
     * If an activity is selected, it returns an object with the following properties:
     * 
     * @property title The title of the activity
     * @property distance The distance of the activity
     * @property duration The duration of the activity
     * @property elevation The total elevation gain of the activity
     * @property startPos The start position of the activity (only if no segment was selected)
     * @property segment The selected route segment
     * @property started The start time of the activity
     * @property showMap Whether the map should be shown or not
     * @property points The points of the activity
     * @property activity The activity itself (details record)
     * @property exports The export status of the activity
     * @property canStart Whether the activity can be started
     * @property canOpen Whether the activity can be opened (i.e. it is a route)
     * @property uploads The upload status of the activity
     * 
     * @returns an object with the properties above
     */
    openSelected():SelectedActivityResponse { 

        if (!this.selected) {
            const props:ActivityErrorDisplayProperties = {title:'Activity', error:'No activity selected'}
            return props
        }

        this.opened = 'selected'

        // needs to be called to initialize the observer
        this.getObserver()

        return this.getSelectedActivityDisplayProps();

        
    }

    /**
     * 
     * Prepares an activity to be started again
     * 
     * This method should be called by the UI before switching to the ride page
     * 
     * The route and start settings will be copied from the currently selected activity
     * 
     * @returns true if the activity could be started, false otherwise
     */
    rideAgain():RideAgainResponse {

        if (!this.getSelected()?.canStart()) {
            return {canStart:false}    
        }

        const startStettings = this.selected.createStartSettings()
        const card = this.selected.getRouteCard() 

        const route = card.getRouteDescription()

        
        card.changeSettings(startStettings)
        card.start()
        return {canStart:true, route};
    }

    async export(format:string):Promise<boolean> {
        const activity = this.getSelected()
        if (!activity){
            return false;
        }

        const emitUpdate = ()=>{this.emitSelected('updated')}
        const observer = new Observer()
        observer.on('export', emitUpdate)

        return await activity.export(format,observer)

    }

    async upload(connectedApp:string):Promise<boolean> {  
        const activity = this.getSelected()
        if (!activity){
            return false;
        }

        const emitUpdate = ()=>{this.emitSelected('updated')}
        const observer = new Observer()
        observer.on('upload', emitUpdate)
        observer.on('export', emitUpdate)

        return await activity.upload(connectedApp,observer)
    }

    /**
     * Prepares an activity to be opened in the RouteDetailsDialog
     * 
     * get the details of the currently selected activity
     * 
     * The route and start settings will be copied from the currently selected activity
     * 
     * @returns the RouteCard that was prepared, or null if no activity was selected
     */
    openRoute():RouteCard {
        if (!this.getSelected()) {
            return null            
        }

        const startStettings = this.getSelected().createStartSettings()
        const card = this.getSelected().getRouteCard()
        card.changeSettings(startStettings)
        return card
    }



    /**
     * Resets the selected activity to null
     * 
     * This method should be called by the UI when the ActivityDetailsDialog is closed
     * 
     * @param keepSelected if true, the selected activity will not be reset
     */
    closeSelected(keepSelected?:boolean):void {
        if (!keepSelected)
            this.selected = null
        
        const observer = this.getObserver()
        if (observer) {
            observer.stop()
            this.observers.selected = null
        }

        delete this.opened 
    }


    /**
     * Searches the repository for activities that match the given search criteria.
     * 
     * For each activity that matches, it will also load the details of the activity.
     * It will filter out all activities where the details could not be loaded
     * 
     * This method will primarily be called by the RideService to prepare the list of previous rides of the same route
     * 
     * @param filter The search criteria to search for
     * 
     * @returns an array of ActivityInfo objects, sorted by the start time of the activity in descending order
     */
    async getPastActivitiesWithDetails( filter:ActivitySearchCriteria): Promise<Array<ActivityInfo>> {
        try {
            const activities  = this.getRepo().search(filter) ?? []

            const promises = []            
            activities.forEach( ai => {
                promises.push(this.loadDetails(ai))
            })            
            await Promise.allSettled(promises)
                        
            return activities.filter( a => a.details!==undefined && a.details!==null )
        }
        catch(err) /* istanbul ignore next */ {
            this.logError(err,'getPastActivitiesWithDetails')
            return []
        }
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

    protected getListObserver() {
        return this.observers.list
    }
    protected getPreloadObserver():PromiseObserver<void> {
        return this.observers.preload as PromiseObserver<void>
    }

    protected async loadActivities():Promise<void> {

        return new Promise<void> ( (done,reject) => {
            const observer = this.getRepo().load()
            observer.on('done',done)
            observer.on('error',reject)
        })
    }

    protected async loadDetails(activity:ActivityInfo):Promise<void> {
        const ai = await this.getRepo().getWithDetails(activity.summary.id)
        if (!ai)
            return;

        if (activity) {
            activity.details = ai.details
        }

    }

    protected async preloadDetails(cnt?:number):Promise<void> {

        if (!cnt)
            return;

        const promises = (this.getRepo().search({})??[]).filter( (a,i)=> i<cnt).map( a=>this.loadDetails(a))

        await Promise.allSettled(promises)
    }



    protected get activities (): Array<ActivityInfo> {
        return this.getRepo().getAll()
    }

    protected getActivity(id:string): ActivityInfo { 
        return this.activities?.find( a => a.summary.id === id)
    }


    protected getListDisplayProperties():ActivityListDisplayProperties {
        
        
        const loading = this.isStillLoading()
        const observer = loading ? this.getListObserver() : undefined
        const activities = loading ? undefined : this.getPastActivities()
        const filter = this.filter


        return {filter,activities ,loading, observer}
    }

    private getSelectedActivityDisplayProps() {
        const activity = this.selected.details;

        const points = activity.logs.map(p => ({ lat: p.lat, lng: p.lng ?? p.lon }));

        const props: SelectedActivityDisplayProperties = {
            title: this.selected.getTitle(),
            distance: activity.distance,
            duration: activity.time,
            elevation: this.selected.getElevation(),
            startPos: activity.segment ? undefined : activity.startPos,
            segment: activity.segment,
            started: new Date(activity.startTime),
            showMap: true,
            points,
            activity,
            exports: this.selected.getExports(),
            canStart: this.selected.canStart(),
            canOpen: this.selected.isRouteAvailable(),
            uploads: this.selected.getUploadStatus(),
        };
        return props;
    }

    protected emitSelected(event:'loaded'|'updated') { 
        
        const displayProps =this.getSelectedActivityDisplayProps()
        this.getObserver()?.emit(event, displayProps)                
    }


    protected emitLists( event:'loaded'|'updated') {
        try {
            const listObserver = this.getListObserver()
            if (listObserver) {
                listObserver.emit(event,this.getListDisplayProperties())
            }
    
        }
        catch(err) {
            this.logError(err,'emitLists',{event})

        }
    }


    @Injectable
    protected getRepo():ActivitiesRepository /* istanbul ignore next */ {
        if (!this.repo)
            this.repo = new ActivitiesRepository()
        return this.repo            
    }

    @Injectable
    protected getActivityUploadFactory() /* istanbul ignore next */ {
        return new ActivityUploadFactory()
    }


}


export const useActivityList = ()=>new ActivityListService()
export const getActivityList = ()=>new ActivityListService()