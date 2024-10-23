import {Step, POWER_TYPE} from  './Step'


describe ( 'Step' ,() => {
    describe ( 'constructor' ,() => {
        test ( 'normal step' ,() => {
            const step = { start:0, end: 30, power: {min:100, max:200} }
            const s = new Step( step )
            expect(s.start).toBe(0);
            expect(s.end).toBe(30);
            expect(s.duration).toBe(30);
            expect(s.power).toEqual( { min:100,max:200,type:'watt'} );
            expect(s.work).toBe( false );
            expect(s.steady).toBe( true );
            expect(s.text).toBe( '' );
        });    

        test ( 'normal step - incremental' ,() => {
            const step = { start:0, end: 30, power: {min:100, max:200},steady:false }
            const s = new Step( step )
            expect(s.start).toBe(0);
            expect(s.end).toBe(30);
            expect(s.duration).toBe(30);
            expect(s.power).toEqual( { min:100,max:200,type:'watt'} );
            expect(s.work).toBe( false );
            expect(s.steady).toBe( false );
            expect(s.text).toBe( '' );
        });    

        test ( 'with text' ,() => {
            const step = { start:0, end: 30, text:'hello world' }
            const s = new Step( step )
            expect(s.start).toBe(0);
            expect(s.end).toBe(30);
            expect(s.duration).toBe(30);
            expect(s.work).toBe( false );
            expect(s.text).toBe( 'hello world' );
        });    

        test ( 'marked as work' ,() => {
            const step = { start:0, end: 30, power: {min:100, max:200},work:true }
            const s = new Step( step )
            expect(s.start).toBe(0);
            expect(s.end).toBe(30);
            expect(s.duration).toBe(30);
            expect(s.power).toEqual( { min:100,max:200,type:'watt'} );
            expect(s.work).toBe( true );
            expect(s.text).toBe( '' );

        });    

        test ( 'Empty' ,() => {
            
            expect( ()=> {new Step()} ).toThrow()
        });    

        test ( 'invalid object' ,() => {
            
            expect( ()=> {new Step({a:1, b:2})} ).toThrow()
        });    

        
    });    


    describe ( 'validate Timimg' ,() => {

        let validateFn

        beforeAll( ()=> {
            validateFn = Step.prototype.validate
            Step.prototype.validate = jest.fn();
        })

        afterAll( ()=> {
            Step.prototype.validate = validateFn;            
        })

        function run  (json)  {
            const s = new Step(json)
            try {
                const res = s.validateTiming();
                if (res) return s;
            }
            catch (err) {
                return err;
            }
        }


        test ( 'start + end, no duration' ,() => {            
            const s = run( { start:0, end: 30} )
            expect(s.start).toBe(0);
            expect(s.end).toBe(30);
            expect(s.duration).toBe(30);

        });    

        test ( 'start + duration, no end' ,() => {            
            const s = run( { start:0, duration: 30} )
            expect(s.start).toBe(0);
            expect(s.end).toBe(30);
            expect(s.duration).toBe(30);
        });    

        test ( 'end + duration, no start' ,() => {            
            const s = run( { end:30, duration: 30} )
            expect(s.start).toBe(0);
            expect(s.end).toBe(30);
            expect(s.duration).toBe(30);

        });    

        test ( 'start+end+duration' ,() => {            
            const s = run( { start:10, end:40, duration: 30} )
            expect(s.start).toBe(10);
            expect(s.end).toBe(40);
            expect(s.duration).toBe(30);

        });    

        test ( 'negative: start + end -- end before start' ,() => {            
            const s = run( { start:40, end: 30} )
            expect(s.message).toMatch('Invalid Step description');
        });    

        test ( 'negative: only duration' ,() => {            
            const s = run( { duration:30} )
            expect(s.message).toMatch('Invalid Step description');
        });    

        test ( 'negative: duration does not match start+end' ,() => {            
            const s = run( { start:0, end:10, duration:30} )
            expect(s.message).toMatch('Invalid step description, duration does not match start and end');
        });    

        
    });    

    describe ( 'validate Power' ,() => {

        let validateFn,s

        beforeAll( ()=> {
            validateFn = Step.prototype.validate
            Step.prototype.validate = jest.fn();
        })

        afterAll( ()=> {
            Step.prototype.validate = validateFn;            
        })

        function run  (json)  {
            const step = { power:json }
            s = new Step(step)
            try {
                const res = s.validatePower();
                if (res) return s;
            }
            catch (err) {
                return err;
            }
        }


        test ( 'min + max, no type' ,() => {            
            const s = run( { min:0, max: 30} )
            expect(s.power.min).toBe(0);
            expect(s.power.max).toBe(30);
            expect(s.power.type).toBe('watt');
        });    


        test ( 'only min, no type' ,() => {            
            const s = run( { min:100} )
            expect(s.power.min).toBe(100);
            expect(s.power.max).toBeUndefined()
            expect(s.power.type).toBe('watt');
        });    

        test ( 'only max, no type' ,() => {            
            const s = run( { max:100} )
            expect(s.power.min).toBeUndefined()
            expect(s.power.max).toBe(100);
            expect(s.power.type).toBe('watt');
        });    

        test ( 'only max, type=' ,() => {            
            const s = run( { min:50,max:100,type:POWER_TYPE.PCT} )
            expect(s.power.min).toBe(50);
            expect(s.power.max).toBe(100);
            expect(s.power.type).toBe(POWER_TYPE.PCT);
        });    


        test ( 'negative: min>max' ,() => {            
            const s = run( { min:40, max: 30} )
            expect(s.message).toMatch('Invalid Step description, min power > max power');
        });    

        test ( 'negative: no values specified' ,() => {            
            const s = run( {} )
            expect(s.message).toMatch('Invalid Step description, power: no values specified');
        });    


        test ( 'negative: min<0' ,() => {            
            const s = run( { min:-40, max: 30} )
            expect(s.message).toMatch('Invalid Step description, min power <0');
        });    

        test ( 'negative: max<0' ,() => {            
            const s = run( { max:-40} )
            expect(s.message).toMatch('Invalid Step description, max power <0');
        });    

        
    });    

    describe ( 'validate Min Max' ,() => {

        let validateFn,s

        beforeAll( ()=> {
            validateFn = Step.prototype.validate
            Step.prototype.validate = jest.fn();
        })

        afterAll( ()=> {
            Step.prototype.validate = validateFn;            
        })

        function run  (json,name)  {
            
            s = new Step({})
            try {
                s.validateLimit(json,name);
                return undefined;
            }
            catch (err) {
                return err;
            }

        }


        test ( 'min + max',() => {            
            const err = run( { min:0, max: 30},'power' )
            expect(err).toBeUndefined();
        });    


        test ( 'only min' ,() => {            
            const err = run( { min:100},'power' )
            expect(err).toBeUndefined();
        });    

        test ( 'only max' ,() => {            
            const err = run( { max:100},'power' )
            expect(err).toBeUndefined();
        });    

        test ( 'negative: min>max' ,() => {            
            const err = run( { min:40, max: 30},'cadence' )
            expect(err.message).toMatch('Invalid Step description, min cadence > max cadence');
        });    

        test ( 'negative: no values specified' ,() => {            
            const err = run( {},'XXX' )
            expect(err.message).toMatch('Invalid Step description, XXX: no values specified');
        });    


        test ( 'negative: min<0' ,() => {            
            const err = run( { min:-40, max: 30},'cadence' )
            expect(err.message).toMatch('Invalid Step description, min cadence <0');
        });    

        test ( 'negative: max<0' ,() => {            
            const err = run( { max:-40},'YYY' )
            expect(err.message).toMatch('Invalid Step description, max YYY <0');
        });    

        
    });    

    describe ( 'getLimits' ,()=> {

        test( 'steady: positive Power + Cadence + Hrm', ()=> {
            const step = new Step( {start:10, end:30, power: {min:0,max:100}, cadence:{min:0, max:90}, hrm:{max:130}})
            const r1 = step.getLimits( 9);
            const r2 = step.getLimits( 10);
            const r3 = step.getLimits( 30);
            const r4 = step.getLimits( 31);

            expect(r1).toBeUndefined();
            expect(r2).toEqual({power: {min:0,max:100,type:'watt'}, cadence:{min:0, max:90}, hrm:{max:130},text:'',work:false,duration:20,remaining:20});
            expect(r3).toEqual({power: {min:0,max:100,type:'watt'}, cadence:{min:0, max:90}, hrm:{max:130},text:'',work:false,duration:20,remaining:0});
            expect(r4).toBeUndefined();
        })

        test( 'incremental: positive Power + Cadence + Hrm', ()=> {
            const step = new Step( {steady:false, start:10, end:30, power: {min:0,max:100}, cadence:{min:0, max:90}, hrm:{min:30,max:130}})
            const r1 = step.getLimits( 9);
            const r2 = step.getLimits( 10);
            const r3 = step.getLimits( 30);
            const r4 = step.getLimits( 31);
            const r5 = step.getLimits( 15);

            expect(r1).toBeUndefined();
            expect(r2).toEqual({power: {min:0,max:0,type:'watt'}, cadence:{min:0, max:0}, hrm:{min:30,max:30},text:'',work:false,duration:20,remaining:20});
            expect(r3).toEqual({power: {min:100,max:100,type:'watt'}, cadence:{min:0, max:90}, hrm:{min:30,max:130},text:'',work:false,duration:20,remaining:0});
            expect(r4).toBeUndefined();
            expect(r5).toEqual({power: {min:25,max:25,type:'watt'}, cadence:{min:0, max:90/4}, hrm:{min:30, max:55},text:'',work:false,duration:20,remaining:15});
        })

        test( 'incremental: min-only Power + Cadence + Hrm', ()=> {
            const step = new Step( {steady:false, start:10, end:30, power: {min:11}, cadence:{min:12}, hrm:{min:130}})
            const r1 = step.getLimits( 9);
            const r2 = step.getLimits( 10);
            const r3 = step.getLimits( 30);
            const r4 = step.getLimits( 31);
            const r5 = step.getLimits( 15);

            expect(r1).toBeUndefined();
            expect(r2).toEqual({power: {min:11,type:'watt'}, cadence:{min:12}, hrm:{min:130},text:'',work:false,duration:20, remaining:20});
            expect(r3).toEqual({power: {min:11,type:'watt'}, cadence:{min:12}, hrm:{min:130},text:'',work:false,duration:20, remaining:0});
            expect(r4).toBeUndefined();
            expect(r5).toEqual({power: {min:11,type:'watt'}, cadence:{min:12}, hrm:{min:130},text:'',work:false,duration:20, remaining:15});
        })

        test( 'incremental: max-only Power + Cadence + Hrm', ()=> {
            const step = new Step( {steady:false, start:10, end:30, power: {max:11}, cadence:{max:12}, hrm:{max:130}})
            const r1 = step.getLimits( 9);
            const r2 = step.getLimits( 10);
            const r3 = step.getLimits( 30);
            const r4 = step.getLimits( 31);
            const r5 = step.getLimits( 15);

            expect(r1).toBeUndefined();
            expect(r2).toEqual({power: {max:11,type:'watt'}, cadence:{max:12}, hrm:{max:130},text:'',work:false,duration:20, remaining:20});
            expect(r3).toEqual({power: {max:11,type:'watt'}, cadence:{max:12}, hrm:{max:130},text:'',work:false,duration:20, remaining:0});
            expect(r4).toBeUndefined();
            expect(r5).toEqual({power: {max:11,type:'watt'}, cadence:{max:12}, hrm:{max:130},text:'',work:false,duration:20, remaining:15});
        })

        test( 'cooldown: power,cadence,hrm', ()=> {
            const step = new Step( {steady:false, cooldown:true, start:10, end:30, power: {min:0, max:100}, cadence:{min:50,max: 150}, hrm: {min:100, max:200}})

            expect(step.getLimits( 9)).toBeUndefined();
            expect(step.getLimits( 10)).toEqual({power: {min:100,max:100,type:'watt'}, cadence:{min:50,max:150}, hrm:{min:100,max:200},text:'',work:false,duration:20, remaining:20});
            expect(step.getLimits( 20)).toEqual({power: {min:50,max:50,type:'watt'}, cadence:{min:50,max:100}, hrm:{min:100,max:150},text:'',work:false,duration:20, remaining:10});
            expect(step.getLimits( 30)).toEqual({power: {min:0,max:0,type:'watt'}, cadence:{min:50,max:50}, hrm:{min:100,max:100},text:'',work:false,duration:20, remaining:0});
            expect(step.getLimits( 31)).toBeUndefined();
        })

        test( 'cooldown: power,cadence,hrm - min only', ()=> {
            const step = new Step( {steady:false, cooldown:true, start:10, end:30, power: {min:20}, cadence:{min:50}, hrm: {min:100}})

            expect(step.getLimits( 9)).toBeUndefined();
            expect(step.getLimits( 10)).toEqual({power: {min:20,type:'watt'}, cadence:{min:50}, hrm:{min:100},text:'',work:false,duration:20, remaining:20});
            expect(step.getLimits( 20)).toEqual({power: {min:20,type:'watt'}, cadence:{min:50}, hrm:{min:100},text:'',work:false,duration:20, remaining:10});
            expect(step.getLimits( 30)).toEqual({power: {min:20,type:'watt'}, cadence:{min:50}, hrm:{min:100},text:'',work:false,duration:20, remaining:0});
            expect(step.getLimits( 31)).toBeUndefined();
        })


    })

});
