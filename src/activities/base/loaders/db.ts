import { EventLogger } from "gd-eventlog";
import { JSONObject, JsonRepository } from "../../../api";
import { Singleton } from "../../../base/types";
import { Observer, PromiseObserver } from "../../../base/types/observer";
import { waitNextTick } from "../../../utils";
import { ActivityDB, ActivityDetails, ActivityInfo, ActivitySummary, UploadInfo  } from "../model";
import { ActivitySearchCriteria } from "./types";

const DB_VERSION = '1'

/**
 * This class is used to load Activities from the local database
 * 
 * The local database is stored in  in %AppDir%/activities and contains a couple of files:
 * - a simple JSON file (db.json), which contains an overview of all Activities, represented in an array of [[ActivitySummary]] 
 * - For every activity in the db.json, one JSON file (identified by _fileName_), which contains the details of that activity [[ActivityDetails]] 
 * - For every activity  in the db.json, one FIT file (identified by _fitFileName_), which contains an export of the actvity in FIT file format
 * - For every activity  in the db.json, one TCX file (identified by _tcxFileName_), which contains an export of the actvity in TCX file format
 *  
 * in order to avoid concurrent usages, the class implements the Singleton pattern
 * 
 */
@Singleton
export class ActivitiesDbLoader {
    protected repo: JsonRepository
    protected loadObserver:Observer
    protected saveObserver:PromiseObserver<void>
    protected isDirty:boolean
    protected tsLastWrite: number
    protected logger: EventLogger
    protected activities: Array<ActivityInfo>
    protected isDBComplete: boolean
    

    constructor() {
        this.logger = new EventLogger('ActivitiesDB')
    }

    /**
     * Loads the Activities from Repo
     * 
     * This will initially only load the summary data, as this will be in most cases sufficient 
     * 
     * @returns An observer that will signal any new/updated activity and when the loading is completed
     * 
     * 
     */
    load(): Observer {       
        if (this.loadObserver)
            return this.loadObserver;

        this.loadObserver = new Observer();
        this._load();
        return this.loadObserver;
    }

    /**
     * Stops the ongoing loading process
     *      
     */
    stopLoad() {        
        this.emitDone()       
    }

    /**
     * Saves an activity in the local repo
     * 
     * @param activity The activity that should be saved
     * @param [writeDetails=true] indicates if only the summary should be update or if also the details shoudl be saved
     */
    async save(activity:ActivityInfo,writeDetails:boolean = true):Promise<void> {
        const stringify = (json) => { try {JSON.stringify(json)} catch {/* */}}

        let prev
        const idx = this.activities.findIndex( ai=> ai.summary.id===activity.summary.id)

        if (idx===-1) {
            // new activity
            this.activities.push( activity)
        }
        else { 
            prev = stringify(this.activities[idx])
            this.activities[idx] = activity           
        }

        const changed = !prev || stringify(activity)!==prev
    
        if (changed) {
            this.isDirty = true;
            this.write()
            if (writeDetails) {
                this.writeDetails(activity)
            }    
        }

    }

    /**
     * Deletes an activity from the local repo
     * 
     * @param activity The activity that should be deleted. The activity can be either provided as object ([[ActivityInfo]]) or just by its ID
     */
    async delete(activity:ActivityInfo|string):Promise<void> {
        let target = activity as ActivityInfo
        if (typeof(activity)==='string') {
            target = this.getActivity(activity)
        }

        if (!target) 
            return;

        const id = target.summary.id
        const idx = this.activities.findIndex( ai=>ai.summary.id===id)
        if (idx) {
            this.activities.splice( idx,1)
            this.write(true)
        }

        const name=target.summary.name
        await this.getRepo().delete(name)
    }

    /**
     * gets the Activity from repo
     * 
     * It returns the [[ActivityInfo]] object of this activity.
     * In case the details haven't been loaded yet, details will not be provided
     * 
     * @param id the unique ID od the activity
     * 
     * @returns the ActivityInfo, which contains the summary and if already available the details
     */
    get(id: string):ActivityInfo {

        const info = this.getActivity(id)
        if (!info)
            return;

        return info
    }

    /**
     * gets the Activity from repo
     * 
     * It returns the [[ActivityInfo]] object of this activity.
     * In case the details haven't been loaded yet, it will load the details from repo and add it to the result
     * 
     * @param id the unique ID od the activity
     * 
     * @returns the ActivityInfo, which contains the summary and details
     */
    async getWithDetails(id: string ):Promise<ActivityInfo> {

        const info = this.getActivity(id)
        if (!info)
            return;

        if (!info.details) {            
            await this.loadDetails(info.summary.name,id)
        }
        return info
    }

    /**
     * searches the repo for activities that are matching certain criteria
     * 
     * If multiple criterias are provided, the will be combined with __AND__, i.e. all criteria need to match
     * 
     * The following criteria can be provided
     * - routeId: returns all activities for a given route
     * - startPos: return all activities with a given start position (typically used together with routeId)
     * - realityFactor: return all activities with a given reality factor (typically used together with routeId)
     * - uploadStatus: can be used to identify routes that have not yet been synced with third party app(s)
     * - isSaved: can be used to identified routes that were not saved yet ( as FIT/TCX)
     * 
     * @param id the unique ID od the activity
     * @param [props.loadDetails=false] identifies if also the details need to be provided
     * 
     * @returns the ActivityInfo of the activities that match all given criteria
     */
    search( criteria:ActivitySearchCriteria):Array<ActivityInfo> {

        let result = this.activities

        if (result?.length>0 && criteria?.routeId) {
            result = result.filter( ai=> ai.summary.routeId===criteria.routeId)
        }
        if (result?.length>0 && criteria?.startPos!==undefined) {
            result = result.filter( ai=> ai.summary.startPos===criteria.startPos)
        }
        if (result?.length>0 && criteria?.realityFactor!==undefined) {
            result = result.filter( ai=> (ai.summary.realityFactor??100)===criteria.realityFactor)
        }
        if (result?.length>0 && criteria?.isSaved!==undefined   ) {
            result = result.filter( ai=> ai.summary.isSaved===criteria.isSaved)
        }
        if (result?.length>0 && criteria?.uploadStatus!==undefined  ) {
            if (Array.isArray(criteria.uploadStatus)) {
                result = result.filter( ai=> { 
                    const requested = criteria.uploadStatus as Array<UploadInfo>
                    const actual =  ai.summary.uploadStatus

                    const r = requested.sort().map( us=> `${us.service}:${us.status}`).join(';')
                    const a = actual.sort().map( us=> `${us.service}:${us.status}`).join(';')
                    return r===a
                })
            }
            else {
                const status = criteria.uploadStatus as UploadInfo               
                result = result.filter( ai=> {
                    const serviceInfo = ai.summary.uploadStatus.find(asi=>asi.service===status.service) 
                    if (!serviceInfo)
                        return false
                    return serviceInfo.status === status.status
                })
            }
        }
        
        return result
    }

    protected async writeRepo() {

        // avoid concurrent updates
        if (this.saveObserver)
            await this.saveObserver.wait()

        const save = async ():Promise<void>=> {
            const isComplete = this.isDBComplete
            try {
                const dbData = {
                    version: DB_VERSION,
                    isComplete,
                    activties: this.activities.map( ai=>ai.summary)
                }
                await this.getRepo().write('db',dbData as JSONObject)
            }
            catch(err) {
                this.logger.logEvent({message:'could not safe repo',error:err.message })
            }
        }
       
        this.saveObserver = new PromiseObserver( save())
        await this.saveObserver.start()
        process.nextTick( ()=> {delete this.saveObserver})

    }


    protected write(enforce:boolean = false) {
        if (enforce)
            this.isDirty = true

        if (this.isDirty && (this.tsLastWrite===undefined || Date.now()-this.tsLastWrite>=1000)) {
            this.isDirty = false;
            this.tsLastWrite = Date.now()            
            this.writeRepo()
        }

        if (this.isDirty && Date.now()-this.tsLastWrite<1000) {
            setTimeout( ()=>{this.write()},  this.tsLastWrite+1000-Date.now())
        }

    }

    protected emitDone() {
        if (this.loadObserver)
            this.loadObserver.emit('done')
        
        waitNextTick().then(()=>{
            this.loadObserver.reset()
            delete this.loadObserver
        })
    }

    protected emitUpdated(activity:ActivityInfo|Array<ActivityInfo>) {
        if (this.loadObserver)
            this.loadObserver.emit('updated',activity)
    }
    protected emitAdded( activity:ActivityInfo|Array<ActivityInfo>) {
        if (this.loadObserver)
            this.loadObserver.emit('added',activity)
    }


    /**
     * load all ActitivySummaries from Repo
     * 
     * Normally this would just have to read the db.json in the Activity directory
     * 
     * However, it might happen that the file does not exist yet ( first launch ever or first launch after upgrade to the version supporting this service)
     * In that case we need to create the DB from scratch by scanning/reading all JSON files in the activities directory
     * 
     * Incyclist App until v0.9.7 does not support directory scans. i.e. it might happen that the DB was created and  there might be even acticvities over time
     * But there would be still a lot of activities that would only exist as JSON file in the activities directory and not in the (Summary) DB
     * 
     * Once, the app gets upgraded to a newer version supporiting the directory scan, this should trigger the scan, so that the missing activities can be added
     * In order to detect this situation, the _isComplete_ flag will be set to false in case the scan could not be done/completed
     *      
     */

    protected async loadSummaries():Promise<void> {
        const dbData = await this.getRepo().read('db')  as unknown as ActivityDB

        // we got some data
        if (dbData) {
            const {activities, isComplete} = dbData

            this.activities = activities.map( summary => ({summary}))
            this.emitAdded(this.activities)

            this.isDBComplete = isComplete

            if (!isComplete) {
                const cnt = activities.length
                const update = await this.scanForActivitiesAndMerge(activities)

                // check if activities were added, if so: update DB
                if (cnt!==update.length) {
                    await this.write(true)
                }
                return
            }
        }

        // no data yet, we need to create a new DB by scanning the directory
        await this.buildFromLegacy()
        return
    }

    /**
     * Scans the activities directory for activities stored as JSON files 
     *      
     * 
     */

    protected async buildFromLegacy():Promise<void> {

        const activities = await this.scanForActivities()
        

        if (activities!==null) {
            this.activities = activities.map( summary => ({summary}))
        }
        
        
        await this.write(true)
      
    }

    /**
     * provides a list of activity names found in the repo directory 
     * 
     * @returns Array with the names of the activities
     */
    protected async listActivities():Promise<Array<string>> {
        return this.getRepo().list()

    }

    protected async loadDetailsByName(name:string):Promise<ActivityDetails> {
        let details
        try {
            details = await this.getRepo().read(name)
        }
        catch(err) {
            this.logger.logEvent({message:'could not load activity details',name, reason:err.message, stack:err.stack})            
        }
        return details
    }

    protected async  loadDetails(name:string, id?:string):Promise<void>{
        const details = await this.loadDetailsByName(name)
        const aid = id??details.id

        const activity = this.getActivity(aid)
        if (activity) {
            activity.details = details
            this.emitUpdated(activity)
        }
    }

    protected async writeDetails(activity:ActivityInfo):Promise<void> {
        const name = activity.summary.name
        this.getRepo().write( name,activity.details as JSONObject)
    }

    protected buildSummary(activity:ActivityDetails,name:string):ActivitySummary {
        const {id, title,route,screenshots,startTime: startTimeUTC,time: rideTime,distance,startPos,realityFactor=100,links,laps} = activity

        const routeId = route?.id
        const shots = screenshots??[]
        const preview = shots.find( s=>s.isHighlight)??shots[0]
        const previewImage = preview?.fileName

        let startTime:number
        if (startTimeUTC)
            startTime = (new Date(startTimeUTC)).getTime()

        const uploadStatus=[]
        if (links?.strava) {
            uploadStatus.push( {service:'strava',status: 'success'})
        }

        return {
            id,title,name, routeId, previewImage,startTime,rideTime,distance,startPos,realityFactor,uploadStatus,laps
        }
    }


    /**
     * provides a list of activities 
     * 
     * @returns r
     */
    protected async scanForActivities():Promise<Array<ActivitySummary>|null> {
        try {

            this.isDBComplete = this.isDBComplete??false

            const names = await this.listActivities()
            if (!names)
                return null;
            

            const promises:Array<Promise<{name:string,details:ActivityDetails}>> = []
            names.forEach( name => promises.push(
                this.loadDetailsByName(name).then( (details)=>({name,details}))
            ))

            const result = await Promise.allSettled(promises)
            const activities:Array<ActivitySummary> = []

            let isComplete = true
            result.forEach( result=> {
                if (result.status==="rejected")
                    isComplete = false
                else  {
                    const details = result.value?.details 
                    const name = result.value.name
                    const summary = this.buildSummary(details,name)
                    activities.push( summary)
                }
            })

            this.isDBComplete = this.isDBComplete??isComplete
            return activities

        }
        catch(err) {
            return null;
        }


    }

    protected async scanForActivitiesAndMerge(activities:Array<ActivitySummary>):Promise<Array<ActivitySummary>> {
        const total = await this.scanForActivities()
        if (total===null)
            return activities

        total.forEach( activity => {
            if ( !activities.map(a=>a.id).includes(activity.id) )
                activities.push(activity)
        })

        return activities
    }

    protected async _load() {
        await this.loadSummaries();      
        this.emitDone()       
    }

    protected getActivity(id:string) {
        return this.activities.find( ai => ai.summary.id===id)
    }

    protected logError(error:Error, fn:string, logProps?) {
        const props = logProps??{}
        this.logger.logEvent({message:'error',error,fn,...props})
    }

    protected getRepo() {
        if (!this.repo)
           this.repo  =JsonRepository.create('activities')
        return this.repo

    }

}