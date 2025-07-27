import IncyclistRoutesApi from '../../base/api'
import { Route } from '../../base/model/route'
import {RoutesApiLoader}  from './api'
import { RouteListService } from '../service'
import { waitNextTick } from '../../../utils'
import gpx from '../../../../__tests__/data/db/routes.json'
import videos from '../../../../__tests__/data/db/videos.json'

import valdrome from '../../../../__tests__/data/rlv/valdrome.json'
import { RouteApiDescription } from '../../base/api/types'


const DEFAULT_ROUTE_API = 'https://dlws.incyclist.com/api/v1/routes'

describe('RoutesApiLoader',()=>{

    describe('load',()=>{

        let api,service

        beforeEach( ()=>{
            service = new RoutesApiLoader()
            //capi = Route.prototype.updateCountryFromPoints
            service.verifyCountry = jest.fn()
            service.save = jest.fn()

            mockRouteList()

        })
        afterEach( ()=>{
            api._reset()
            //Route.prototype.updateCountryFromPoints = capi

        })

        const run = ():Promise<{added,updated,routes}>=>new Promise( done =>{
                
            let added = 0;
            let updated = 0;
            const routes:Array<Route> = []

            const observer = service.load()

            observer.on( 'route.added', route=>{
                routes.push(route)
                //console.log('added '+route.description.title)
                added++;
            })
            observer.on( 'route.updated', route=>{
                const existingIdx = routes.findIndex( r=>r.description.id===route.description.id)
                if (existingIdx!==-1)
                    routes[existingIdx]=route
                else 
                routes.push(route)
                updated++;
                //console.log('updated '+route.description.title)
            })
            observer.on('done' ,async ()=>{
                observer.stop()
                await waitNextTick()        

                done({added,updated,routes})
            })
            
        })

        const setupApiMock = ( props:{gpx?, videos?, details?,fn?}) =>{           
            api = IncyclistRoutesApi.getInstance() 
            api.getRouteDescriptions = jest.fn( async (q) => {return ( q.type==='gpx' ? props.gpx??gpx: props.videos??videos) as RouteApiDescription[]})
            api.getRouteDetails = jest.fn( async id => props.details? props.details[id] : props.fn(id)??undefined)
            
            api.getBaseUrl = jest.fn().mockReturnValue(DEFAULT_ROUTE_API)
            return api
        }

        const mockRouteList = () => {
            const list = new RouteListService()
            list.createPreview = jest.fn().mockResolvedValue(true)
            return list

        }



        test('initial load',async ()=>{

            setupApiMock({fn: ()=>valdrome})

            const run1 = await run()

            expect(run1.routes.length).toBe(34)
            expect(run1.updated).toBe(0) 
            expect(service.save).toHaveBeenCalledTimes(34)

            
        })


    })

})