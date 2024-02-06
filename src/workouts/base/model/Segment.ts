import { valid } from '../../../utils/valid';
import { Step } from './Step'
import { CurrentStep, SegmentDefinition, StepDefinition } from './types';

export class Segment extends Step implements SegmentDefinition {

    steps: Array<Step>
    repeat: number

    constructor( opts:SegmentDefinition=null, ignoreValidate?:boolean) {
        super(opts,true);

        this.steps = [];
        this.repeat = 1;
        this.type = 'segment';

        if ( valid(opts)) {
            this.init(opts, ignoreValidate);
            if ( ignoreValidate===undefined || ignoreValidate===false)
                this.validate();
        } 
        
    }

    protected init(opts: SegmentDefinition, ignoreValidate: boolean) {
        const start = opts.start || 0;
        this.start = start;
        let stepStart = start;

        if (opts instanceof Step) {
            this.steps = [new Step(opts)];
        }

        else if (opts.steps !== undefined) {
            if (Array.isArray(opts.steps)) {
                opts.steps.forEach(step => {
                    if (step.start === undefined) {
                        step.start = stepStart;
                    }
                    const s = new Step(step);
                    stepStart = s.end;
                    this.steps.push(s);
                });
            }
            else {
                if (ignoreValidate !== true)
                    throw new Error(`Invalid Segment description, no steps defined`);

            }

        }
        else {
            if (ignoreValidate === undefined || ignoreValidate === false)
                throw new Error(`Invalid Segment description, no steps defined`);
        }
        if (opts.repeat !== undefined) this.repeat = opts.repeat;


        this.duration = this.getDuration();
        this.end = this.start + this.duration;
    }

    /* istanbul ignore next */
    validate() {
        this.validateTiming();
    }

    validateTiming() {
        let prev;

        this.steps.forEach( s => {
            s.validateTiming();
            if ( prev!==undefined) {
                const delta1  = Math.abs(prev.end-s.start);
                if (delta1>0) throw new Error(`Invalid Segment description, start & prev end not matching`)
            }
            prev = s;
        });
        return true;
    }

    prepareNext(json:StepDefinition|SegmentDefinition) {
        /* istanbul ignore next */
        if ( json===undefined)
            return;
        
        const empty = this.steps.length===0;
        if (json.start===undefined && json.end===undefined) {
            json.start = !empty ? this.steps[this.steps.length-1].end : 0;
        }
        if ( empty) {
            this.start = 0;
        }
    }

    push(s) {
        if ( s===undefined)
            return;

        this.prepareNext(s);
        let step;
        if ( s instanceof Step || s instanceof Segment)
            step = s;
        else 
            step = new Step(s)
        this.steps.push(step);
        this.duration += step.getDuration();
        this.end = this.start + this.duration;

        this.validate();
        
    }

    getDuration() {
        return this.getSingleDuration() * this.repeat;
    }

    getSingleDuration() {
        if (this.steps.length===0) return 0;
        return this.steps.map(s=>s.duration).reduce( (a,b) => a+b );
    }

    getStart() {
        if ( this.start!==undefined)
            return this.start;
        else {
            if ( this.steps.length>0 )
                return this.steps[0].start
            else 
                return undefined;
        }
    }

    getEnd() {
        return this.getStart()+this.getDuration();
    }

    getStep(ts:number):Step {
        if  (ts>=this.getStart() && ts<=this.getEnd()) {
            const segTime = ts-this.getStart();
            let part = (segTime % this.getSingleDuration());
            part +=this.getStart()
            if ( part===this.getStart() && segTime>0)
                part+=this.getSingleDuration();
            const found = this.steps.find( s => {
                return (part>=s.start && part<=s.end) 
            })
            return found;
        }
        
    }

    getLimits(ts,includeStepInfo=false):CurrentStep {
        const step = this.getStep(ts);
        if ( step===undefined) 
            return undefined;
        
        const segTime = ts-this.getStart();
        let part = (segTime % this.getSingleDuration());
        part +=this.getStart()
        if ( part===this.getStart() && segTime>0)
            part+=this.getSingleDuration();
        
        
        return step.getLimits(part,includeStepInfo);
    }

}

