import {Step} from './Step'
import {Segment} from './Segment'
import { Category, DataType, PlanDefinition, ScheduledWorkout, SegmentDefinition, StepDefinition, WorkoutDefinition } from './types';
import { valid } from '../../../utils/valid';
import { getBindings } from '../../../api';

/** 
 * @public 

 * This represents a workout
 * */

export class Workout extends Segment implements WorkoutDefinition {

    public id:string
    _hash:string
    public name:string;
    public description: string
    public category?:Category
    // true when the caller supplied an explicit id/hash (e.g. a workout reloaded from
    // storage) - once true, the id/hash is authoritative and must never be recomputed
    // from steps, no matter how they are populated or mutated afterwards
    protected explicitId:boolean

    constructor( opts:WorkoutDefinition) {
        super(opts,true);

        this.name = opts.name || '';
        this._hash = opts.hash;
        this.explicitId = !!(opts.id || opts.hash)
        this.description= opts.description || undefined;
        this.repeat = 1;
        this.type = 'workout'
        this.category = opts.category

        this.steps = []
        this.start = this.end = this.duration =0

        opts.steps?.forEach( s=> {
            try {
                if (s.type==='step')
                    this.addStep(s)
                if (s.type==='segment' && (s as Segment).steps )
                    this.addSegment(s)
            }
            catch{
                // ignore
            }
        })

        // hash is computed lazily from {name,description,steps,repeat} - must only be
        // read (and thereby cached) once steps have actually been populated above,
        // otherwise every workout with the same name/description hashes identically.
        // For parsers that populate steps *after* construction (via addStep/addSegment,
        // see below), this initial value gets kept in sync by refreshHash().
        this.id = opts.id|| this.hash
    }

    get hash():string {
        if (this._hash)
            return this._hash

        const {name,description,steps,repeat } = this

        const crypto = getBindings().crypto?? require('node:crypto')
        this._hash = crypto.createHash('md5').update(JSON.stringify({name,description,steps,repeat })).digest('hex');
        return this._hash
    }

    /**
     * Keeps id/hash in sync whenever steps are added after construction (ZwoParser,
     * IntervalsJsonParser and others parse content by calling addStep/addSegment on an
     * already-constructed, still-empty Workout). A no-op when an explicit id/hash was
     * supplied - that value is authoritative and must never be overwritten by later
     * content changes (e.g. a workout reloaded from storage).
     */
    protected refreshHash() {
        if (this.explicitId)
            return
        this._hash = undefined
        this.id = this.hash
    }

    getSegment(time:number):Segment {
        const s = this.steps.find( s=> s.getStart()<=time && s.getEnd()>time)
        if (s?.type==='segment')
            return s as Segment;
    }

    addStep( step:StepDefinition) {
        if ( valid(step)) {

            if ( step.duration===undefined && step.start===undefined && step.end===undefined )
                throw new Error(`Invalid Step description, start&end or duration needs to be provided `)
            this.prepareNext(step);

            if ( step instanceof Step)
                this.push(step);
            else {
                const s = new Step(step);
                this.push(s);
            }
            this.refreshHash()
        }
    }

    addSegment( segment:SegmentDefinition) {
        if ( valid(segment)) {
            this.prepareNext(segment);

            if ( segment instanceof Segment)
                this.push(segment);
            else {
                const s = new Segment(segment);
                this.push(s);
            }
            this.refreshHash()
        }
    }

}

export class Plan implements PlanDefinition {
    type: DataType
    id?:string
    name?: string
    description?: string
    workouts: Array<ScheduledWorkout>
    protected _hash?:string

    constructor( plan:PlanDefinition) {
        this.workouts = []
        this.type = 'plan'

        const {id,name,description,workouts,hash} = plan
        this._hash = hash;
        this.name = name;
        this.description = description
        this.workouts = workouts

        // hash is computed lazily from {name,description,workouts} - must only be read
        // (and thereby cached) once workouts has actually been populated above, otherwise
        // every plan with the same name/description hashes identically regardless of content
        this.id = id || this.hash;
    }

    get hash():string {
        if (this._hash)
            return this._hash

        const {name,description,workouts } = this

        const data = JSON.stringify({name,description,workouts })
        const crypto = getBindings().crypto?? require('node:crypto')

        this._hash = crypto.createHash('md5').update(data).digest('hex');     

        return this._hash
    }

    addWorkoutSchedule(week:number, day:number, workoutId:string ) {
        const existing = this.workouts.findIndex( sw=> sw.week===week && sw.day===day)       
        if (existing)
            this.workouts[existing]= {day,week,workoutId}
        else 
            this.workouts.push({day,week,workoutId})
    }

    deleteWorkoutSchedule(week:number, day:number) {
        const existing = this.workouts.findIndex( sw=> sw.week===week && sw.day===day)       
        if (existing)
            this.workouts.splice(existing,1)
    }


}