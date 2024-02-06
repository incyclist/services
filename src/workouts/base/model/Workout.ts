import {Step} from './Step'
import {Segment} from './Segment'
import { Category, DataType, PlanDefinition, ScheduledWorkout, SegmentDefinition, StepDefinition, WorkoutDefinition } from './types';
import { valid } from '../../../utils/valid';
import md5 from 'md5'

export class Workout extends Segment implements WorkoutDefinition {
    id:string
    _hash:string
    name:string;
    description: string
    category?:Category

    constructor( opts:WorkoutDefinition) {        
        super(opts,true);

        this.name = opts.name || '';
        this._hash = opts.hash;
        this.id = opts.id|| this.hash
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
        
        
       
    }

    get hash():string {
        if (this._hash)
            return this.hash

        const {name,description,steps,repeat } = this

        this._hash = md5( JSON.stringify({name,description,steps,repeat }))
        return this._hash
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
        this.id = id || this.hash;
        this.name = name;
        this.description = description
        this.workouts = workouts
        


    }

    get hash():string {
        if (this._hash)
            return this.hash

        const {name,description,workouts } = this

        this._hash = md5( JSON.stringify({name,description,workouts }))
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