import { JsonRepository } from "../../../api"
import { Singleton } from "../../../base/types"
import {  Observer, PromiseObserver } from "../../../base/types/observer"
import { Loader } from "./loader"
import { Plan, Workout } from "../../base/model/Workout"
import { EventLogger } from "gd-eventlog"
import { waitNextTick } from "../../../utils"
import { valid } from "../../../utils/valid"
import { JSONObject } from "../../../utils/xml"

/**
 * This class is used to load Workouts from the local database
 * The local database is a simple JSON file (db.json in %AppDir%/workouts), which contains an array of [[WorkoutDefinition]]
 * 
 * in order to avoid concurrent usages, the class implements the Singleton pattern
 * 
 */
@Singleton
export class WorkoutsDbLoader extends Loader{
   
    protected saveObserver: PromiseObserver<void>
    protected repo: JsonRepository
    protected tsLastWrite:number
    protected isDirty:boolean
    protected workoutsSaveObserver:{ [index:string]:PromiseObserver<void>} = {}
    protected logger:EventLogger
    

    constructor () {
        super()
        this.workouts = []     
        this.isDirty = true;
        this.logger = new EventLogger('WorkoutsDB')        
    }

    /**
     * Loads all workouts from the local workout DB
     * 
     * @returns [[Observer]] Observer object which will notify consumers about status changes of the loading process
     * @emits __workout.added__  for every workout that was loaded, having the [[Workout]] as argument of the event
     * @emits __done__  when all records have bee loaded
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
     * Stops loading more workouts. 
     * 
     * To be precise: it wil not immediately interrupt the loading (reading and processing), 
     * but will cause that no further events will be sent 
     * 
     * @emits __done__  indicating that all records have been processed
     * 
     */

    stopLoad():void {
        if (this.loadObserver) {
            this.loadObserver.emit('done')
            waitNextTick().then( ()=>{
                delete this.loadObserver
            })            
        }
    }

    /**
     * Saves a workout that has been added or updated
     * 
     */
    async save(workout:Workout|Plan,enforceWrite:boolean=false):Promise<void> {
        // istanbul ignore next
        if (!valid(workout))
            return;

        const stringify = (json) => { 
            try {
                return JSON.stringify(json)
            } catch  { 
            /* */
            }
        }

        let prev
        const idx = this.workouts.findIndex( d=> d.id===workout.id)

        let changed = false
        if (idx===-1) {
            changed = true
            this.workouts.push( workout)
        }
        else { 
            prev = stringify({...this.workouts[idx]})
            this.workouts[idx] = workout
            changed = stringify({...workout})!==prev
        }

        if (changed || enforceWrite) {
            this.isDirty = true;
            this.write()
        }
    }

    /**
     * Deletes a workout from the repo
     * 
     * @throws 'workout not found' if the workout was not existing in the internal workout cache
     */
    async delete(workout:Workout|Plan):Promise<void> {
        const id = workout.id
        const idx = this.workouts.findIndex( d=> d.id===id)
        if (idx==-1)
            throw new Error('workout not found')

        this.workouts.splice(idx,1)

        this.isDirty = true;
        this.write()
    }

    protected getRepo() {
        if (!this.repo)
            this.repo  =JsonRepository.create('workouts')
        return this.repo
    }

    protected async _load() {

        const workouts = await this.getRepo().read('db') 
        if (workouts) {

            const items = workouts as unknown as Array<Workout|Plan>
            items.forEach( item=> {
                const workout = new Workout(item)
                this.workouts.push(workout )
                this.emitAdded(workout)
            })
            
        }

        this.emitDone()
      
    }

    protected async writeRepo() {
        // avoid concurrent updates

        if (this.saveObserver)
            await this.saveObserver.wait()

        const save = async ():Promise<void>=> {
            try {
                await this.getRepo().write('db',this.workouts as unknown as JSONObject)
            }
            catch(err) {
                this.logger.logEvent({message:'could not safe repo',error:err.message })
            }
        }
       
        this.saveObserver = new PromiseObserver( save())
        await this.saveObserver.start()
        process.nextTick( ()=> {delete this.saveObserver})

    }


    protected write(enforced:boolean=false) {
        if (enforced || (this.isDirty && (this.tsLastWrite===undefined || Date.now()-this.tsLastWrite>=1000))) {
            this.isDirty = false;
            this.tsLastWrite = Date.now()            
            this.writeRepo()
        }

        if (this.isDirty && Date.now()-this.tsLastWrite<1000) {
            const delayUntilNextWrite =  this.tsLastWrite+1000-Date.now()
            setTimeout( ()=>{
                this.write(true)
            }, delayUntilNextWrite)
        }

    }

    protected emitUpdated(workout: Workout|Plan) {
        if (this.loadObserver)
            this.loadObserver.emit('workout.updated',workout)
    }
    protected emitAdded(workout: Workout|Plan) {
        if (this.loadObserver)
            this.loadObserver.emit('workout.added',workout)
    }


    protected emitDone() {
        if (this.loadObserver)
            this.loadObserver.emit('done')
        
        waitNextTick().then(()=>{
            this.loadObserver.reset()
            delete this.loadObserver
        })
    }



}
