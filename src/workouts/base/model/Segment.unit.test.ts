import {Step, STEP_TYPE} from './Step'
import {Segment} from  './Segment'


describe ( 'Segment' ,() => {

    let validateFn;
    beforeEach( ()=> {
        validateFn = Step.prototype.validate
        Segment.prototype.validate = jest.fn();
    })

    afterEach( ()=> {
        Segment.prototype.validate = validateFn;
    })

    describe ( 'constructor' ,() => {
        test ( 'multiple steps - normal' ,() => {
            
            const steps= [ { duration:10,text:'a'}, {duration:10,text:'b'} ]
            const s = new Segment( {start:0, end:20,steps} )
            expect(s.steps.length).toBe(2)
            expect(s.steps[0].start).toBe(0)
            expect(s.steps[0].end).toBe(10)
            expect(s.steps[1].start).toBe(10)
            expect(s.steps[1].end).toBe(20)
            expect(s.repeat).toBe(1)
        });    

        test ( 'multiple steps with only start' ,() => {
            const steps = [ { duration:10, text:'a'}, {duration:10, text:'b'} ]
            const s = new Segment( {start:10, repeat:3,steps} )
            expect(s.steps.length).toBe(2)
            expect(s.steps[0].start).toBe(10)
            expect(s.steps[0].end).toBe(20)
            expect(s.steps[1].start).toBe(20)
            expect(s.steps[1].end).toBe(30)
            expect(s.repeat).toBe(3)
            expect(s.type).toBe(STEP_TYPE.SEGMENT)
        });    

        test ( 'multiple steps with end --> end will be ignored' ,() => {
            const steps = [ { duration:10, text:'a'}, {duration:10, text:'b'} ]
            const s = new Segment( {end:10, repeat:3,steps} )
            expect(s.start).toBe(0)
            expect(s.end).toBe(60)
            expect(s.duration).toBe(60)

            expect(s.steps.length).toBe(2)
            expect(s.steps[0].start).toBe(0)
            expect(s.steps[0].end).toBe(10)
            expect(s.steps[1].start).toBe(10)
            expect(s.steps[1].end).toBe(20)
            expect(s.repeat).toBe(3)
            expect(s.type).toBe(STEP_TYPE.SEGMENT)
        });    

        test ( 'multiple steps with duration --> duration will be ignored' ,() => {
            const steps = [ { duration:10, text:'a'}, {duration:10, text:'b'} ]
            const s = new Segment( {duration:110, repeat:3,steps} )
            expect(s.start).toBe(0)
            expect(s.end).toBe(60)
            expect(s.duration).toBe(60)

            expect(s.steps.length).toBe(2)
            expect(s.steps[0].start).toBe(0)
            expect(s.steps[0].end).toBe(10)
            expect(s.steps[1].start).toBe(10)
            expect(s.steps[1].end).toBe(20)
            expect(s.repeat).toBe(3)
            expect(s.type).toBe(STEP_TYPE.SEGMENT)
        });    



        test ( 'no steps' ,() => {
            expect( ()=>new Segment( {start:0, end:20} ) ).toThrow()
        });    

        test ( 'no steps, no validation' ,() => {
            expect( ()=>new Segment( {start:0, end:20},true ) ).not.toThrow()

        });    


        test ( 'single step' ,() => {
            const step = new Step( {start:0,duration:10,hrm:{max:180}})
            const s = new Segment( step)
            expect(s.steps.length).toBe(1)
            expect(s.steps[0]).toEqual( {start:0,end:10,duration:10,type:STEP_TYPE.STEP, power:undefined,cadence:undefined,hrm:{max:180},work:false,text:'',steady:true,cooldown:false})
            expect(s.repeat).toBe(1)
        });    

    });    

    describe ( 'validateTiming' ,() => {

        let validateFn;
        beforeAll ( ()=> {
            validateFn = Segment.prototype.validate;
            Segment.prototype.validate = jest.fn();
        })

        afterAll ( ()=> {
            Segment.prototype.validate= validateFn
        })

        test ( 'multiple steps' ,() => {
            const steps = [ { duration:10}, {duration:10} ]
            const s = new Segment( {start:0,steps} )
            const res = s.validateTiming();
            expect(res).toBe(true)
            
        });   

        test ( 'negative: gap between steps' ,() => {
            const steps = [ { start:0, end:10}, {start:20,end:30} ]
            const s = new Segment( {start:0,steps} )
            expect ( ()=> {
                s.validateTiming();
            }).toThrow()
            
            
        });    


    });

    describe ( 'push' ,() => {

        test ( 'single step' ,() => {
            const s = new Segment( )
            s.push( new Step({start:0,duration:10,text:'A'}))
            expect(s.getStart()).toBe(0)
            expect(s.getEnd()).toBe(10)
            expect(s.getDuration()).toBe(10)
        });    

        test ( 'segment' ,() => {
            const s = new Segment(  )

            const child = new Segment( {  repeat:2, steps:[{duration:10,text:'child'}]}  )
            s.push( child )

            expect(s.getDuration()).toBe(20)
            expect(s.getStart()).toBe(0)
            expect(s.getEnd()).toBe(20)
        });    

        test ( 'single step - with end' ,() => {
            const s = new Segment(  )
            s.push( {duration:10,end:10,text:'A'})
            expect(s.getStart()).toBe(0)
            expect(s.getEnd()).toBe(10)
            expect(s.getDuration()).toBe(10)
        });    

        test ( 'single step - non empty segment' ,() => {
            const steps = [ { duration:10,text:'a'}, {duration:10, text:'b'} ]
            const s = new Segment( {start:10,steps} )
            s.push( {duration:10,text:'A'})

            expect(s.steps.length).toBe(3)
            expect(s.getStart()).toBe(10)
            expect(s.getEnd()).toBe(40)
            expect(s.getDuration()).toBe(30)
        });    

    });




    describe ( 'getDuration' ,() => {

        test ( 'multiple steps' ,() => {
            const steps = [ { duration:10,a:1,b:2}, {duration:10, a:1, b:3} ]
            const s = new Segment( {start:0,steps} )
            expect(s.getDuration()).toBe(20)
        });    

        test ( 'multiple steps' ,() => {
            const steps = [ { duration:10,a:1,b:2}, {duration:10, a:1, b:3} ]
            const s = new Segment( {start:0,repeat:3,steps} )
            expect(s.getDuration()).toBe(60)
        });    

    });


    describe ( 'getStart' ,() => {
        let validateFn;
        beforeAll ( ()=> {
            validateFn = Segment.prototype.validate;
            Segment.prototype.validate = jest.fn();
        })

        afterAll ( ()=> {
            Segment.prototype.validate= validateFn
        })


        test ( 'start and durations defined' ,() => {
            const steps = [ { duration:10,a:1,b:2}, {duration:10, a:1, b:3} ]
            const s = new Segment( {start:90,steps} )
            expect(s.getStart()).toBe(90)
        });    

        test ( 'end and durations defined -- will be ignored' ,() => {
            const steps = [ { duration:10,a:1,b:2}, {duration:10, a:1, b:3} ]
            const s = new Segment( {start:90,steps} )

            s.start = undefined;
            s.end = 100;
            s.duration = 10;
            expect(s.getStart()).toBe(90)
        });    

        test ( 'empty segent' ,() => {
            const s = new Segment(  )
            expect(s.getStart()).toBeUndefined()
        });    


    });


    describe ( 'getEnd' ,() => {
        let validateFn;
        beforeAll ( ()=> {
            validateFn = Segment.prototype.validate;
            Segment.prototype.validate = jest.fn();
        })

        afterAll ( ()=> {
            Segment.prototype.validate= validateFn
        })


        test ( 'only start and durations defined' ,() => {
            const steps = [ { duration:10,a:1,b:2}, {duration:10, a:1, b:3} ]
            const s = new Segment( {start:90,steps} )
            expect(s.getEnd()).toBe(110)
        });    

        test ( 'end is defined -> will be ignored' ,() => {
            const steps = [ { duration:10,a:1,b:2}, {duration:10, a:1, b:3} ]
            const s = new Segment( {start:90,steps} )
            s.end = 1111;
            expect(s.getEnd()).toBe(110)
        });    



    });


    describe ( 'getStep' ,() => {
        let validateFn;
        let s;

        beforeAll ( ()=> {
            validateFn = Segment.prototype.validate;
            Segment.prototype.validate = jest.fn();
        })

        afterAll ( ()=> {
            Segment.prototype.validate= validateFn
        })


        test ( 'segent starting at 10, single repetition' ,() => {
            const steps = [ { duration:10,text:'a'}, {duration:10, text:'b'} ]

            s = new Segment( {start:10,steps} )
        
            const s1 = s.getStep(0);
            const s2 = s.getStep(10);
            const s3 = s.getStep(20);
            const s4 = s.getStep(29.999);
            const s5 = s.getStep(30);

            expect(s1).toBeUndefined();
            expect(s2.text).toBe('a');
            expect(s3.text).toBe('b');
            expect(s4.text).toBe('b');
            expect(s5).toBeUndefined();
             s= undefined
        });    

        test ( 'segent starting at 10, multipe repetition2' ,() => {
            const steps = [ { duration:10,text:'a'}, {duration:10, text:'b'} ]
            s = new Segment( {start:10,repeat:10,steps} )

            const s1 = s.getStep(0);
            const s2 = s.getStep(10);
            const s3 = s.getStep(40);
            const s4 = s.getStep(49);
            const s5 = s.getStep(209.9999);
            const s6 = s.getStep(210);

            expect(s1).toBeUndefined();
            expect(s2.text).toBe('a');
            expect(s3.text).toBe('b');
            expect(s4.text).toBe('b');
            expect(s5.text).toBe('b');
            expect(s6).toBeUndefined();
        });    


    });


    describe ( 'getLimits' ,() => {
        let validateFn,s;

        beforeAll ( ()=> {
            validateFn = Segment.prototype.validate;
            Segment.prototype.validate = jest.fn();
        })

        afterAll ( ()=> {
            Segment.prototype.validate= validateFn
        })


        test ( 'segment starting at 10, single repetition' ,() => {
            const steps = [ { duration:10,text:'a', hrm:{min:10, max:110}}, {duration:10, text:'b', hrm:{min:30, max:130}} ]
            s = new Segment( {start:10,steps} )

            const s1 = s.getLimits(0);
            const s2 = s.getLimits(10);
            const s3 = s.getLimits(19.9999);
            const s4 = s.getLimits(29.9999);
            const s5 = s.getLimits(30);

            expect(s1).toBeUndefined();
            expect(s2.hrm).toEqual( {min:10,max:110});
            expect(s3.hrm).toEqual( {min:10,max:110});
            expect(s4.hrm).toEqual( {min:30,max:130});
            expect(s5).toBeUndefined();
        });    

        test ( 'segent starting at 10, incremental' ,() => {
            const steps = [ 
                new Step({start:10,duration:10,text:'a', hrm:{min:10, max:110},steady:false},false), 
                new Step({start:20,duration:10, text:'b', hrm:{min:30, max:130}},false) ]
            s = new Segment( {start:10,steps} )

            const s1 = s.getLimits(0);
            const s2 = s.getLimits(10);
            const s3a = s.getLimits(19.999);
            const s3 = s.getLimits(20);
            const s4a = s.getLimits(29.999);
            const s4 = s.getLimits(30);
            const s5 = s.getLimits(31);

            expect(s1).toBeUndefined();
            expect(s2.hrm).toEqual( {min:10,max:10});
            expect(s3a.hrm).toEqual( {min:10,max:expect.closeTo(110,0)});
            expect(s3.hrm).toEqual( {min:30,max:130});
            expect(s4a.hrm).toEqual( {min:30,max:expect.closeTo(130,0)});
            expect(s4).toBeUndefined();
            expect(s5).toBeUndefined();
        });    

        test ( 'duration and remaining are correctly calculated' ,() => {
            const steps = [ { duration:30,text:'a', hrm:{min:10, max:110},steady:false}, {duration:40, text:'b'} ]
            s = new Segment( {start:10,steps} )
            const check = (s,ts, isResultExpected?, expectedDuration?,expectedRemaining?) => {
                const res = s.getLimits(ts);
                if (!isResultExpected)
                    expect(res).toBeUndefined();
                else {
                    expect(Math.round(res.duration)).toBe(expectedDuration);
                    expect(Math.round(res.remaining)).toBe(expectedRemaining);
                }
            }
    
    
            check(s,0,false);
            check(s,10,true,30,30);
            check(s,20,true,30,20);
            check(s,30,true,30,10);
            check(s,40,true,40,40);
            check(s,41,true,40,39);
            check(s,50,true,40,30);
            check(s,60,true,40,20);
            check(s,70,true,40,10);
            check(s,79.9999,true,40,0);
            check(s,80,false);
            check(s,90,false);
        });    

        test ( 'Ramps' ,() => {
            const steps = [ 
                { start:0, duration:30,text:'a', power:{min:50, max:110},steady:false}, 
                { start:30, duration:30,text:'a', power:{min:50, max:110},steady:false,cooldown:true} ]
            const s = new Segment( {start:0,steps} )

            const check = (s,ts, isResultExpected, expectedDuration?,expectedRemaining?,minExpected?, maxExpected?) => {
                const res = s.getLimits(ts);
                if (!isResultExpected)
                    expect(res).toBeUndefined();
                else {
                    expect(Math.round(res.duration)).toBe(expectedDuration);
                    expect(Math.round(res.remaining)).toBe(expectedRemaining);
                    expect(Math.round(res.power.min)).toBe(minExpected);
                    expect(Math.round(res.power.max)).toBe(maxExpected);
                }
            }
    
    
            check(s,0,true,30,30,50,50);
            check(s,10,true,30,20,70,70,);
            check(s,20,true,30,10,90,90);
            check(s,30,true,30,30,110,110);
            check(s,40,true,30,20,90,90);
            check(s,50,true,30,10,70,70);
            check(s,59.99999,true,30,0,50,50);
            check(s,60,false);
            check(s,61,false);
        });    




    });

});