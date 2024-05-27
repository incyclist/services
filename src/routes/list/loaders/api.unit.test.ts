import { sleep } from '../../../utils/sleep'
import IncyclistRoutesApi from '../../base/api'
import { DEFAULT_ROUTE_API } from '../../base/api/consts'
import { Route } from '../../base/model/route'
import {RoutesApiLoader}  from './api'
import { RouteListService } from '../service'

describe('RouteApiLoader',()=>{

    describe('load',()=>{


        test.skip('e2e test - should only be executed manually',async ()=>{

            const api = IncyclistRoutesApi.getInstance() 
            api['getBaseUrl'] = jest.fn().mockReturnValue(DEFAULT_ROUTE_API)

            const list = new RouteListService()
            list.createPreview = jest.fn().mockResolvedValue(true)
            
            
            const loader = new RoutesApiLoader()
            const observer = loader.load()
            const routes:Array<Route> = []

            observer.on( 'route.added', route=>{
                routes.push(route)
                //console.log('added ',route.description.title)
            })
            observer.on( 'route.updated', route=>{console.log('updated ',route.description.title)})

            await sleep(5000)
            
        },6000)
    })

})