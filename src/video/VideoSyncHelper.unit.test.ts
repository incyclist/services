import routeData from  '../../__tests__/data/rlv/holzweiler.json'
import { VideoSyncHelper } from './VideoSyncHelper'
import { createFromJson } from '../routes/base/utils/route'
import { Route } from 'incyclist-devices'
import { RouteApiDetail } from '../routes/base/api/types'

describe('VideoSyncHelper',()=>{

    describe('getVideoTimeByPosition',()=>{

        // implement these tests based on routeData
        // use an existing helper in this repo to generate the Route object from the routeData
        // these tests are for the VideoSyncHelper.getPositionByVideoTime


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
})