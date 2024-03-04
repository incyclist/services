import { Route } from '../../routes/base/model/route'
import { createFromJson, validateRoute } from '../../routes/base/utils/route'
import { ActivityDetails } from '../base'
import {ActivityDuration} from './duration'
import sydney from '../../../__tests__/data/routes/sydney.json'
import { RouteApiDetail } from '../../routes/base/api/types'

describe ('ActivityDuration',()=>{

    describe ('getRemainingTime',()=>{

        describe ('normal route',()=>{

            let route:Route, duration
            beforeEach( ()=> {
                
                route  = createFromJson(sydney as unknown as RouteApiDetail)
                validateRoute(route.details)
                const user = { weight:75, ftp:200}
                const startTime = new Date().toISOString()
                const activity:ActivityDetails = {
                    title:'test',id:'test',route:{id:'test',name:'test',hash:'1'},user,logs:[], startTime,time:0, timePause:0,timeTotal:0,
                    startPos:0, realityFactor:100,
                    totalElevation:0, distance:0
                }
                
                duration = new ActivityDuration(activity)

            })

            test('from start 150W 85kg',()=>{
                const result = duration.getRemainingTime({route,routePos:0,power:150})              
                expect(result).toBeCloseTo(513,0) // 8:33 min
            })


            test('from start 150W 45km/h',()=>{

                const result = duration.getRemainingTime({route,routePos:0,power:150,speed:45}) //duration.calculateRemainingTime(route,0,150,85, 50.43/3.6)                
                
                expect(result).toBeCloseTo(496,0) // 8:16 min
            })

            test('power is 0',()=>{

                const result = duration.getRemainingTime({route,routePos:0,power:0})                
                expect(result).toBeUndefined()
                
            })

            test('just before end of 1st round 150W 85kg 40m/h',()=>{
                duration.getRemainingTime({route,routePos:3799,power:150,speed:40})            

                const result = duration.getRemainingTime({route,routePos:3800,power:150,speed:40})              
                expect(result).toBeCloseTo(0,0) // 8:19 min
            })

            test('2nd round from start 150W 85kg 40m/h',()=>{
                const result = duration.getRemainingTime({route,routePos:3802,power:150,speed:40})              
                expect(result).toBeCloseTo(499,0) // 8:19 min
            })

        })

    
    })

    describe ('lap',()=>{

    })

    describe ('free ride with options',()=>{

    })

    describe ('video without gpx',()=>{

    })

})
