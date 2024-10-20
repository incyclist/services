import { ActivityDetails } from "../base";
import {ActivityStatsCalculator} from './stats'

describe('ActivityStats',()=>{

    describe('PowerCurve',()=>{

        test('5s',()=>{
            const activity:Partial<ActivityDetails> = {
                logs:[]
            }
            const calc = new ActivityStatsCalculator(activity as ActivityDetails)
            calc.add( {time:1, power:100, timeDelta:1, cadence:90,speed:30 })
            calc.add( {time:1, power:120, timeDelta:1, cadence:90,speed:30 })
            calc.add( {time:1, power:140, timeDelta:1, cadence:90,speed:30 })
            calc.add( {time:1, power:130, timeDelta:1, cadence:90,speed:30 })
            calc.add( {time:1, power:200, timeDelta:1, cadence:90,speed:30 })

            calc.addPowerCurve()

            const curve = activity.stats?.powerCurve??{}
            expect(curve[1]).toBe(200)
            expect(curve[2]).toBe(165)
            expect(curve[5]).toBe(138)
            expect(curve[10]).toBeUndefined()
        })

        test('5min',()=>{
            const activity:Partial<ActivityDetails> = {
                logs:[]
            }
            const calc = new ActivityStatsCalculator(activity as ActivityDetails)
            calc.add( {time:1, power:100, timeDelta:1, cadence:90,speed:30 })
            calc.add( {time:1, power:120, timeDelta:1, cadence:90,speed:30 })
            calc.add( {time:1, power:140, timeDelta:1, cadence:90,speed:30 })
            calc.add( {time:1, power:130, timeDelta:1, cadence:90,speed:30 })
            calc.add( {time:1, power:200, timeDelta:1, cadence:90,speed:30 })
            for (let i=0;i<299;i++) {
                calc.add( {time:1, power:180, timeDelta:1, cadence:90,speed:30 })    
            }
            calc.add( {time:1, power:200, timeDelta:1, cadence:90,speed:30 })
            for (let i=0;i<60;i++) {
                calc.add( {time:1, power:50, timeDelta:1, cadence:90,speed:30 })    
            }

            for (let i=0;i<60;i++) {
                calc.add( {time:1, power:190, timeDelta:1, cadence:90,speed:30 })    
            }

            calc.addPowerCurve()
            const curve = activity.stats?.powerCurve??{}
            expect(curve[1]).toBeCloseTo(200,0)
            expect(curve[2]).toBeCloseTo(190,0)
            expect(curve[5]).toBeCloseTo(190,0)
            expect(curve[10]).toBeCloseTo(190,0)
            expect(curve[30]).toBeCloseTo(190,0)
            expect(curve[60]).toBeCloseTo(190,0)
            expect(curve[120]).toBeCloseTo(180,0)
            expect(curve[300]).toBeCloseTo(180,0)
            expect(curve[600]).toBeUndefined()
        })

        test('same power, different timeDeltas',()=>{
            const activity:Partial<ActivityDetails> = {
                logs:[]
            }
            const calc = new ActivityStatsCalculator(activity as ActivityDetails)
            calc.add( {time:1, power:150, timeDelta:1, cadence:90,speed:30 })
            calc.add( {time:2, power:150, timeDelta:1, cadence:90,speed:30 })
            calc.add( {time:3, power:150, timeDelta:1, cadence:90,speed:30 })
            calc.add( {time:4, power:150, timeDelta:1.0010000000000003, cadence:90,speed:30 })
            calc.add( {time:5, power:150, timeDelta:0.9989999999999997, cadence:90,speed:30 })
            calc.add( {time:6, power:150, timeDelta:1, cadence:90,speed:30 })
            calc.add( {time:7, power:150, timeDelta:1, cadence:90,speed:30 })
            calc.add( {time:8, power:150, timeDelta:1.0380000000000003, cadence:90,speed:30 })
            calc.add( {time:8, power:150, timeDelta:0.9619999999999997, cadence:90,speed:30 })
            calc.add( {time:10, power:150, timeDelta:1, cadence:90,speed:30 })
             calc.addPowerCurve()
            const curve = activity.stats?.powerCurve??{}
            expect(curve[1]).toBeCloseTo(150,0)
            expect(curve[2]).toBeCloseTo(150,0)
            expect(curve[5]).toBeCloseTo(150,0)
            expect(curve[10]).toBeCloseTo(150,0)
            

        })

        test.skip('5h',()=>{
            const activity:Partial<ActivityDetails> = {
                logs:[]
            }
            const calc = new ActivityStatsCalculator(activity as ActivityDetails)
            for (let i=0;i<3600;i++) {
                calc.add( {time:1, power:100, timeDelta:1, cadence:90,speed:30 })
            }
            const ts = Date.now()
            calc.addPowerCurve()
            const curve = activity.stats?.powerCurve??{}
            expect(curve[1]).toBeCloseTo(100,0)
            expect(curve[7200]).toBeCloseTo(100,0)
        })




    })

})