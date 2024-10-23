import { Observer } from "../../../base/types/observer";
import { waitNextTick } from "../../../utils";
import { IncyclistWorkoutsApi} from "../../base/api";
import { PlanDefinition } from "../../base/model";
import { Workout,Plan } from "../../base/model/Workout";
import { WorkoutsDbLoader } from "./db";
import { Loader } from "./loader";


export class WorkoutsApiLoader extends Loader {

    protected api: IncyclistWorkoutsApi

    constructor () {
        super()
        this.api = new IncyclistWorkoutsApi() // singelton
    }


    load():Observer {
        // no concurrent loads
        if (this.loadObserver)
            return this.loadObserver

        this.loadObserver = new Observer()

        this.api.getWorkouts().catch().then (async (res:Array<Workout|Plan>) => {
            this.workouts = res

            res.forEach( record=> {

                let data = record;

                if (record.type==='workout') data = new Workout(record)
                if (record.type==='plan') data = new Plan(record as PlanDefinition)

                const id = data.id
                const fromDB = this.getFromDB(id)
                if (!fromDB || fromDB.hash!==data.hash) {
                    this.loadObserver.emit( fromDB?  'workout.updated' : 'workout.added', data)
                    this.save(record)
                }
            })

            this.loadObserver.emit('done')
            await waitNextTick()
            delete this.loadObserver
           
        });

        return this.loadObserver
        
    }


    protected getFromDB(id:string) {
        const db = new WorkoutsDbLoader()
        return db.get(id)

    }

    async save(record:Workout|Plan):Promise<void> {
        const db = new WorkoutsDbLoader()
        await db.save(record)
    }



 
}