import routeData from  '../../__tests__/data/rlv/holzweiler.json'
import { VideoSyncHelper } from './VideoSyncHelper'
import { createFromJson } from '../routes/base/utils/route'
import { Route } from 'incyclist-devices'
import { RouteApiDetail } from '../routes/base/api/types'
import { RLVActivityStatus, RLVPlaybackStatus } from './types'

describe('VideoSyncHelper',()=>{

    describe('getVideoTimeByPosition',()=>{

        const route = createFromJson(routeData as unknown as RouteApiDetail)

        test('middle of ride', () => {
            // Assume video duration is available in routeData or route object
            const videoSyncHelper = new VideoSyncHelper(route,0)
            
            const time = videoSyncHelper.getVideoTimeByPosition(5000)
            expect(time).toBeCloseTo(578,0)
        })

        test('beyond end loop mode', () => {
            const totalDistance = route.description.distance??0
            const videoSyncHelper = new VideoSyncHelper(route,0,{loopMode:true})
            
            const time = videoSyncHelper.getVideoTimeByPosition(totalDistance + 10)
            expect(time).toBeCloseTo(2.5,1)
        })

        test('beyond end non-loop mode', () => {
            const totalDistance = route.description.distance??0
            const videoSyncHelper = new VideoSyncHelper(route,0,{loopMode:false})
            
            const time = videoSyncHelper.getVideoTimeByPosition(totalDistance + 10)
            expect(time).toBe(993)

        })

        test('beginning', () => {
            const videoSyncHelper = new VideoSyncHelper(route,0,{loopMode:false})
            const time = videoSyncHelper.getVideoTimeByPosition(0)
            expect(time).toBe(0)
        })

        test('negative time', () => {
            const videoSyncHelper = new VideoSyncHelper(route,0,{loopMode:false})
            const time = videoSyncHelper.getVideoTimeByPosition(-10)
            expect(time).toBe(0)
        })
        

    })

    describe('update',()=>{
        const route = createFromJson(routeData as unknown as RouteApiDetail)

        
        let updateTime:any
        let updateRate:any

        const initMock = ( sh:any, rlvStatus:Partial<RLVPlaybackStatus>, activityStatus:Partial<RLVActivityStatus>) => {            
            const prevRlvStatus = sh.rlvStatus??{}
            const prevActStatus = sh.activityStatus??{}
            sh.rlvStatus = { ...prevRlvStatus, ...rlvStatus}
            sh.activityStatus = { ...prevActStatus, ...activityStatus}

            sh.logEvent = jest.fn() // (...args )=> console.log(args))
            updateTime = sh.updateTime = jest.fn()
            updateRate = sh.updateRate = jest.fn()
        }
        test('rlv in lap 1, activity in lap 2', () => {
            // Assume video duration is available in routeData or route object
            const videoSyncHelper = new VideoSyncHelper(route,0,{loopMode:true})
            const totalDistance = route.description.distance??0
            
            console.log(totalDistance)
            initMock(videoSyncHelper, { routeDistance:8296, speed:30, rate:1, time:9000}, {routeDistance:8300, speed:30})
            videoSyncHelper.onUpdate(['activity:lap','activity:sped'])           
            expect(videoSyncHelper.logEvent).toHaveBeenCalledWith( expect.objectContaining({delta:-4}))
            expect(updateTime).not.toHaveBeenCalled()
            expect(updateRate).toHaveBeenCalledWith( expect.closeTo(1.1,1)) // speed up playback
        })

        test('rlv in lap 2, activity in lap 1', () => {
            // Assume video duration is available in routeData or route object
            const videoSyncHelper = new VideoSyncHelper(route,0,{loopMode:true})
            const totalDistance = route.description.distance??0
            
            console.log(totalDistance)
            initMock(videoSyncHelper, { routeDistance:3, speed:30, rate:1, time:9000}, {routeDistance:8296, speed:30})
            videoSyncHelper.onUpdate(['activity:lap','activity:sped'])           
            expect(videoSyncHelper.logEvent).toHaveBeenCalledWith( expect.objectContaining({delta:4.9}))
            expect(updateTime).not.toHaveBeenCalled()
            expect(updateRate).toHaveBeenCalledWith( expect.closeTo(0.9,1)) // slow down playback
        })

        test('rlv in lap 3, activity in lap 2', () => {
            // Assume video duration is available in routeData or route object
            const videoSyncHelper = new VideoSyncHelper(route,0,{loopMode:true})
            const totalDistance = route.description.distance??0
            
            console.log(totalDistance)
            initMock(videoSyncHelper, { routeDistance:3, speed:30, rate:1, time:9000}, {routeDistance:16595, speed:30})
            videoSyncHelper.onUpdate(['activity:lap','activity:sped'])      
            
            expect(videoSyncHelper.logEvent).toHaveBeenCalledWith( expect.objectContaining({delta:3.8}))
            expect(updateTime).not.toHaveBeenCalled()
            expect(updateRate).toHaveBeenCalledWith( expect.closeTo(0.9,1))  // slow down playback
      })

    })
})