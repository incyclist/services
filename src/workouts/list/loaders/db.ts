import { JSONObject, JsonRepository } from "../../../api"
import { Singleton } from "../../../base/types"
import {  Observer, PromiseObserver } from "../../../base/types/observer"
import { Loader } from "./loader"
import { Plan, Workout } from "../../base/model/Workout"
import { EventLogger } from "gd-eventlog"
import { waitNextTick } from "../../../utils"

@Singleton
export class WorkoutsDbLoader extends Loader{
   
    protected saveObserver: PromiseObserver<void>
    protected repo: JsonRepository
    protected workouts: Array<Workout|Plan>
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

    load(): Observer {       
        if (this.loadObserver)
            return this.loadObserver;

        this.loadObserver = new Observer();
        this._load();
        return this.loadObserver;

    }

    stopLoad() {
        delete this.loadObserver;
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


    async save(workout:Workout|Plan):Promise<void> {
        const stringify = (json) => { try {JSON.stringify(json)} catch {/* */}}

        let prev
        const idx = this.workouts.findIndex( d=> d.id===workout.id)

        if (idx===-1)
            this.workouts.push( workout)
        else { 
            this.workouts[idx] = workout
            
        }

        const changed = !prev || stringify(this.workouts)!==prev
    
        if (changed) {
            this.isDirty = true;
            this.write()
        }
    }

    async delete(workout:Workout|Plan):Promise<void> {
        const id = workout.id
        const idx = this.workouts.findIndex( d=> d.id===id)
        if (idx==-1)
            throw new Error('workout not found')

        this.workouts.splice(idx,1)

        this.isDirty = true;
        await this.write()
    }


    protected async writeRepo() {
        // avoid concurrent updates
        if (this.saveObserver)
            await this.saveObserver.wait()

        const save = async ():Promise<void>=> {
            try {
                await this.repo.write('db',this.workouts as unknown as JSONObject)
            }
            catch(err) {
                this.logger.logEvent({message:'could not safe repo',error:err.message })
            }
        }
       
        this.saveObserver = new PromiseObserver( save())
        await this.saveObserver.start()
        process.nextTick( ()=> {delete this.saveObserver})

    }


    protected write() {

        if (this.isDirty && (this.tsLastWrite===undefined || Date.now()-this.tsLastWrite>=1000)) {
            this.isDirty = false;
            this.tsLastWrite = Date.now()            
            this.writeRepo()
        }

        if (this.isDirty && Date.now()-this.tsLastWrite<1000) {
            setTimeout( ()=>{this.write()},  this.tsLastWrite+1000-Date.now())
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
