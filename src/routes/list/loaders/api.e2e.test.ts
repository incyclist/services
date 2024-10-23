import { sleep } from '../../../utils/sleep'
import IncyclistRoutesApi from '../../base/api'
import { DEFAULT_ROUTE_API } from '../../base/api/consts'
import { Route } from '../../base/model/route'
import {RoutesApiLoader}  from './api'
import { RouteListService } from '../service'
import clone from '../../../utils/clone'
import { waitNextTick } from '../../../utils'

describe('RouteApiLoader',()=>{

    describe('load',()=>{


        test('e2e test - should only be executed manually',async ()=>{

            const api = IncyclistRoutesApi.getInstance() 
            api['getBaseUrl'] = jest.fn().mockReturnValue(DEFAULT_ROUTE_API)

            const list = new RouteListService()
            list.createPreview = jest.fn().mockResolvedValue(true)
            
            
            const loader = new RoutesApiLoader()
            const routes:Array<Route> = []


            const run = ():Promise<{added,updated}>=>new Promise( done =>{
                
                let added = 0;
                let updated = 0;

                const observer = loader.load()

                observer.on( 'route.added', route=>{
                    routes.push(route)
                    added++;
                })
                observer.on( 'route.updated', route=>{
                    updated++;
                })
                observer.on('done' ,async ()=>{
                    console.log('added:',added)
                    console.log('updated:',updated)
                    await waitNextTick()        

                    done({added,updated})
                })
                
            })

            const run1 = await run()
            console.log(run1)

            expect(routes.length).toBe(14)
            expect(run1.updated).toBe(6) // missing country code


            const existing = Array.from(routes)
            api['getRouteDescriptionFromDB'] = jest.fn( (id)=> existing.find( r=>r.description.id===id))

            const run2 = await run()
            expect(routes.length).toBe(14)
            expect(run2.updated).toBe(0) // missing country code
            expect(run2.added).toBe(0) // missing country code


            const updateTarget = existing.find( r=>r.description.version??0>1) 

            if (updateTarget) {
                const prevVersion  = updateTarget.description.version??1

                updateTarget.description.version  = prevVersion -1;
                

            
                const run3 = await run()
                expect(routes.length).toBe(14)
                expect(run3.updated).toBe(1) 
                expect(run3.added).toBe(0) 
            }

            
            
        },20000)
    })

})