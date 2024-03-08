import { DEFAULT_ROUTE_API } from './consts'
import  IncyclistRoutesApi  from './index'

class Api extends IncyclistRoutesApi {
    getBaseUrl() {
        return DEFAULT_ROUTE_API
    }
}

/*
    This is only used for manual testing
*/

describe('RouteListService',()=>{

    describe('GetRouteDescriptions',()=>{
        test('gpx',async ()=>{
            const rl = new Api()
    
            const routes = await rl.getRouteDescriptions({type:'gpx'})
            console.log(routes)
        })
    
        test('video no category',async ()=>{
            const rl = new Api()
    
            const routes = await rl.getRouteDescriptions({type:'video'})
            console.log(routes)
        })
    
        test('video with category',async ()=>{
            const rl = new Api()
    
            const routes = await rl.getRouteDescriptions({type:'video', category:'demo'})
            console.log(routes)
        })
    
    })

    describe('GetRouteDetails',()=>{
        test('gpx',async ()=>{
            const rl = new Api()
    
            await rl.getRouteDetails( '8dbfa4c8-be36-4068-9ca1-cc9dcbfd42d7')
            
        })
    
        test('video',async ()=>{
            const rl = new Api()
    
            await rl.getRouteDetails( '8dbfa4c8-be36-4068-9ca1-cc9dcbfd42d7')
            
        })
        
    })

})