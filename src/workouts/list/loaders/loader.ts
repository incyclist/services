import { Observer } from "../../../base/types/observer";
import { Plan, Workout } from "../../base/model/Workout";

export class Loader {
    protected loadObserver: Observer
    protected workouts: Array<Workout|Plan>

    constructor() {
        this.workouts=[]
    }

    load():Observer {
        throw new Error('not implemnted')
    }

    stopLoad() {
        delete this.loadObserver
    }

    get(id:string):Workout|Plan {
        const record = this.workouts.find( r=>r.id===id)
        return record
    }

}