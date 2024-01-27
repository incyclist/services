import { EventLogger } from "gd-eventlog";
import { Card, CardList } from "../../../base/cardlist";
import { Observer, PromiseObserver } from "../../../base/types/observer";
import { Workout } from "../../base/model/Workout";
import { BaseCard } from "./base";
import { WorkoutCardType } from "./types";
import { WorkoutsDbLoader } from "../loaders/db";

export class WorkoutCard extends BaseCard implements Card<Workout> {

    protected workout: Workout
    protected logger:EventLogger
    protected deleteable:boolean 
    protected list:CardList<Workout>
    protected cardObserver = new Observer()

    constructor(workout:Workout, props?:{list?: CardList<Workout>} ) {
        super()
        const {list} = props||{};

        this.workout = workout
        this.list = list
        this.deleteable = false;

        this.initialized = false;
        this.logger = new EventLogger('WorkoutCard')
    }

    async save():Promise<void> {
        try {
            return await this.getRepo().save(this.workout)        
        }
        catch(err) {
            this.logError(err,'save')
        }
        
    }

    setList(list:CardList<Workout>) {
        this.list = list
    }

    delete(): PromiseObserver<boolean> {
        throw new Error("Method not implemented.");
    }

    getId(): string {
        throw new Error("Method not implemented.");
    }

    update(workout:Workout) {
        try {
            this.workout = workout
            this.save()
            this.emitUpdate()
        }
        catch(err) {
            this.logError(err,'update')
        }
    }


    getData(): Workout {
        return this.workout
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    setData(data: Workout) {
        try {
            this.workout = data
        }
        catch(err) {
            this.logError(err,'setData')
        }

    }

    getCardType():WorkoutCardType {
        return "Workout"
    }
    getDisplayProperties() {
        throw new Error("Method not implemented.");
    }

    enableDelete(enabled:boolean=true) {
        this.deleteable = enabled
    }

    canDelete() {
        return this.deleteable
    }


    protected logError( err:Error, fn:string) {
        this.logger.logEvent({message:'error', error:err.message, fn, stack:err.stack})
    }

    protected getRepo() {
        return new WorkoutsDbLoader()
    }

    protected emitUpdate() {
        if (this.cardObserver)
            this.cardObserver.emit('update', this.getDisplayProperties())
    }



}