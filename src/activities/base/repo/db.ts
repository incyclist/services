import { EventLogger } from "gd-eventlog";
import { JsonRepository, getBindings } from "../../../api";
import { Singleton } from "../../../base/types";
import { Observer, PromiseObserver } from "../../../base/types/observer";
import { waitNextTick } from "../../../utils";
import { ActivityDB, ActivityDetails, ActivityInfo, UploadInfo  } from "../model";
import { ActivitySearchCriteria } from "./types";
import { buildSummary } from "../utils";
import { JSONObject } from "../../../utils/xml";
import { useRouteList } from "../../../routes";
import { ActivitiesDBMigratorFactory } from "./migration/factory";
import { Injectable } from "../../../base/decorators/Injection";
import { useUnitConverter } from "../../../i18n";

export const DB_VERSION = '4'
export const DB_NAME = 'db'

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
export class ActivitiesRepository {
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
        const stringify = (json) => { try {return JSON.stringify(json)} catch {/* */}}

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
        }

        if (writeDetails) {
            this.writeDetails(activity)
        }    


    }

    /**
     * Migrates the given activity to the latest data format.
     * 
     * This function is responsible for updating the activity details to match the current version of the database schema.
     * 
     * @param activity The activity to be migrated, containing its summary and details.
     */
    migrate(activity:ActivityInfo, writeSummary = true):ActivityDetails {
        try {
            const {details} = activity??{}
            if (!details) 
                return

            let summaryChanged = false
            let detailsChanged = false    
           
            const {version} = details

            if (version===DB_VERSION)
                return details

            const verNo = version===undefined ? 0 :Number(version)
            const currentVerNo = Number(DB_VERSION)


            ActivitiesDBMigratorFactory.inject('repo',this)
            ActivitiesDBMigratorFactory.inject('routeList',this.getRouteList())
            for (let i=1;i<=currentVerNo;i++) {
                if (verNo<i) {
                    const migrater = ActivitiesDBMigratorFactory.create(i-1)
                    if (migrater) {
                        const res = migrater.migrate(activity)
                        summaryChanged = summaryChanged || res?.summaryChanged
                        detailsChanged = detailsChanged || res?.detailsChanged
                    }    
                }
            }                                
    
            details.version = DB_VERSION

            this.writeDetails(activity)
            if (summaryChanged && writeSummary) {
                this.writeRepo()            
            }
            return details
    
        }
        catch(err) {
            this.logError(err,'migrate',{activity})
        }
    }

    async migrateDB() {

        let deleted = []
        try {
            const promises = []
            this.activities.forEach( activity => {
                if (activity.details) {
                    const details = this.migrate(activity)                    
                    activity.summary = buildSummary(details??activity.details)            
                }
                else 
                    promises.push( this.loadDetailsById(activity.summary.id).then( (details)=> {
                        if (!details ) {
                            deleted.push(activity.summary.id)
                            return
                        }

                        const updated = {...activity,details}
                        const updatedDetails = this.migrate(updated,false)
                        activity.summary = buildSummary(updatedDetails??details)                
                        
                    }))            
            })
    
            await Promise.allSettled(promises)

            if (deleted.length) {
                this.activities = this.activities.filter( ai => !deleted.includes(ai.summary.id))                
            }
        
            await this.writeRepo()
    
        }
        catch(err) {
            this.logError(err,'migrateDB')
        }
    }

    getFilename(activityName:string):string {
        const baseDir = this.getRepo().getPath()
        const path = this.getBindings().path
        return path.join(baseDir,`${activityName}.json`)


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
        if (idx!==-1) {
            this.activities.splice( idx,1)
            this.write(true)
        }

        const tcx = target.details?.tcxFileName
        if (tcx) this.getBindings().fs.unlink(tcx)

        const fit = target.details?.fitFileName
        if (fit) this.getBindings().fs.unlink(fit)



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
     * gets all Activities from repo
     * 
     * @returns the ActivityInfo of all the activities 
     */
    getAll() {
        return  this.activities??[]
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

        
        let result = this.activities?.filter(ai => ai.summary.rideTime>30)

        result = this.checkIdFilter(result, criteria);
        result = this.checkHashFilter(result, criteria);
        result = this.checkStartPosFilter(result, criteria);
        result = this.checkEndPosFilter(result, criteria);
        result = this.checkRealityFactorFilter(result, criteria);
        result = this.checkIsSavedFilter(result, criteria);        
        result = this.checkUploadStatusFilter(result, criteria);
        result = this.checkTimeFilter(result, criteria);
        result = this.checkDistanceFilter(result, criteria);

        if (criteria?.maxValues!==undefined && result?.length>criteria.maxValues) {
             result = result.slice(0,criteria.maxValues-1)
         }
        
        return result
    }


    private checkIdFilter(result: ActivityInfo[], criteria: ActivitySearchCriteria) {
        if (result?.length > 0 && criteria?.routeId) {
            result = result.filter(ai => ai.summary.routeId === criteria.routeId);
        }        
        return result
    }

    private checkHashFilter(result: ActivityInfo[], criteria: ActivitySearchCriteria) {
        if (result?.length > 0 && criteria?.routeHash) {
            result = result.filter(ai => ai.summary.routeHash === criteria.routeHash);
        }
        return result
    }


    private checkStartPosFilter(result: ActivityInfo[], criteria: ActivitySearchCriteria) {

        
        let startPos = criteria?.startPos
        if (typeof startPos!=='number' &&  startPos?.value!==undefined) {
            startPos = this.getUnitConverter().convert( startPos.value, 'distance', {from:startPos.unit, to:'m'})
        }

        if (result?.length > 0 && startPos !== undefined) {
            result = result.filter(ai => ai.summary.startPos === startPos);
        }
        return result
    }
    private checkEndPosFilter(result: ActivityInfo[], criteria: ActivitySearchCriteria) {
        let endPos = criteria?.endPos
        if (typeof endPos!=='number' &&  endPos?.value!==undefined) {
            endPos = this.getUnitConverter().convert( endPos.value, 'distance', {from:endPos.unit, to:'m'})
        }

        if (result?.length > 0 && criteria?.endPos !== undefined) {
            result = result.filter(ai => ai.summary.endPos === criteria.endPos);
        }
        return result
    }

    private checkRealityFactorFilter(result: ActivityInfo[], criteria: ActivitySearchCriteria) {
        if (result?.length > 0 && criteria?.realityFactor !== undefined) {
            result = result.filter(ai => (ai.summary.realityFactor ?? 100) === criteria.realityFactor);
        }
        return result;
    }

    private checkIsSavedFilter(result: ActivityInfo[], criteria: ActivitySearchCriteria) {
        if (result?.length > 0 && criteria?.isSaved !== undefined) {
            result = result.filter(ai => ai.summary.isSaved === criteria.isSaved);
        }
        return result;
    }

    private checkUploadStatusFilter(result: ActivityInfo[], criteria: ActivitySearchCriteria) {
        if (result?.length > 0 && criteria?.uploadStatus !== undefined) {
            if (Array.isArray(criteria.uploadStatus)) {
                result = result.filter(ai => {
                    const requested = Array.from(criteria.uploadStatus as Array<UploadInfo>);
                    const actual = Array.from(ai.summary.uploadStatus);
    
                    const sortFn = (a, b) => a.service.localeCompare(b.service);
                    requested.sort(sortFn)
                    actual.sort(sortFn)

                    const r= requested.map(us => `${us.service}:${us.status}`).join(';');
                    const a = actual.map(us => `${us.service}:${us.status}`).join(';');
                    return r === a;
                });
            }
            else {
                const status = criteria.uploadStatus
                result = result.filter(ai => {
                    const serviceInfo = ai.summary.uploadStatus.find(asi => asi.service === status.service);
                    if (!serviceInfo)
                        return false;
                    return serviceInfo.status === status.status;
                });
            }
        }
        return result;
    }

    private checkTimeFilter(result: ActivityInfo[], criteria: ActivitySearchCriteria) {
        if (result?.length > 0 && criteria?.minTime !== undefined) {
            result = result.filter(ai => ai.summary.rideTime >= criteria.minTime);
        }
        return result;
    }

    private checkDistanceFilter(result: ActivityInfo[], criteria: ActivitySearchCriteria) {
        if (result?.length > 0 && criteria?.minDistance !== undefined) {
            result = result.filter(ai => ai.summary.distance >= criteria.minDistance);
        }
        return result;
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
                    activities: this.activities.map( ai=>ai.summary)
                }
                await this.getRepo().write(DB_NAME,dbData as JSONObject)
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
        const dbData = await this.getRepo().read(DB_NAME)  as unknown as ActivityDB

        // we got some data
        if (dbData) {
            const {activities=[]} = dbData

            this.activities = activities.map( summary => ({summary}))
            this.emitAdded(this.activities)
            
            const cnt = activities.length
            const names = await this.scanForNewActivities()
            if (names) {
                await this.bulkAddActivities(names)
            }        
            
            // check if activities were added, if so: update DB
            if (cnt!==this.activities.length) {
                this.write(true)
            }

            await this.fixMissingHash()     
            
            
            if (dbData.version!==DB_VERSION) {
                this.logger.logEvent({message:'migrating activities database', from:DB_VERSION, to:DB_VERSION})
                try {
                    await this.migrateDB()
                    this.logger.logEvent({message:'finished migrating activities database', from:DB_VERSION, to:DB_VERSION})
                }
                catch(err) {
                    this.logError(err,'loadSummaries')
                }
            }
            return
        }

        // no data yet, we need to create a new DB by scanning the directory
        await this.buildFromLegacy()
    }

    /**
     * Scans the activities directory for activities stored as JSON files 
     *      
     * 
     */

    protected async buildFromLegacy():Promise<void> {
        this.activities = []
        const names = await this.scanForNewActivities()
        if (names) {
            await this.bulkAddActivities(names)
        }        
        this.write(true)      
    }

    /**
     * provides a list of activity names found in the repo directory 
     * 
     * @returns Array with the names of the activities
     */
    protected async listActivities():Promise<Array<string>> {
        return this.getRepo().list([DB_NAME])

    }

    /**
     * In earlier versions of this class, the routeHash was not added to the ActivitySummary
     * This method fixes legacy records without that routeHash
     * 
     */
    protected async fixMissingHash() {
        try {
            const target = this.activities.filter( ai=>ai.summary && ai.summary.routeHash===undefined)
            if (!target || target.length===0) {
                return
            }
            this.logger.logEvent( {message:'fixing missing hashes in activities', cnt:target.length})
            const promises = []
            target.forEach( ai=> {
                promises.push( this.loadDetails( ai.summary.name).then( ()=> ai.summary.routeHash = ai.details?.route?.hash))
            })

            await Promise.allSettled(promises)

            this.write(true)
        }
        catch(err) {
            this.logError(err,'fixMissingHash')
        }
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

    protected async loadDetailsById(id:string):Promise<ActivityDetails> { 
        const activity = this.getActivity(id)
        return await this.loadDetailsByName(activity.summary.name)
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

    protected async bulkAddActivities( names: Array<string>):Promise<void> {
        
        const promises:Array<Promise<{name:string,details:ActivityDetails}>> = []
        names.forEach( name => promises.push(
            this.loadDetailsByName(name).then( (details)=>({name,details}))
        ))

        const result = await Promise.allSettled(promises)
        

        result.forEach( result=> {
            if (result.status==="rejected")
                return;
            else  {
                try {
                    const details = result.value?.details 
                    const name = result.value?.name
                    if (details) {
                        const summary = buildSummary(details,name)
                        this.activities.push( {summary})
                        this.emitAdded({summary})
    
                    }
                }
                catch(err) {
                    this.logError(err,'bulkAddActivities.loop')
                }
            }
        })
    }


    protected async writeDetails(activity:ActivityInfo):Promise<void> {
        const name = activity.summary.name
        this.getRepo().write( name,activity.details as unknown as JSONObject)
    }

    /**
     * provides a list of activities that are not yet stored in the repo
     * 
     * @returns r
     */
    protected async scanForNewActivities():Promise<Array<string>|null> {
        try {


            let names = await this.listActivities()
            if (!names)
                return null;
            
            const known = this.activities?.map( ai=> ai.summary.name)
            names = names.filter( name=> !known.includes(name))
            return names;
        }
        catch {
            return null;
        }
    }



    protected async _load() {
        await this.loadSummaries(); 

        this.emitDone()       
    }

    protected getActivity(id:string) {
        return this.activities.find( ai => ai.summary.id===id)
    }

    protected logError(err:Error, fn:string, logProps?) {
        const props = logProps??{}
        this.logger.logEvent({message:'error',fn,error: err.message,...props, stack:err.stack})
    }

    protected getRepo() {
        if (!this.repo)
           this.repo  =JsonRepository.create('activities')
        return this.repo

    }

    protected getRouteList()
    {
        return useRouteList()
    }

    @Injectable
    protected getBindings() {
        return getBindings()
    }

    @Injectable
    protected getUnitConverter() {
        return useUnitConverter()
    }

}

