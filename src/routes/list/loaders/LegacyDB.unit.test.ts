import routesData from '../../../../__tests__/data/db/routes.json';
import videosData from '../../../../__tests__/data/db/videos.json';

import { JsonRepository } from '../../../api';
import { Route } from "../../base/model/route";
import { RoutesLegacyDbLoader } from "./LegacyDB";



describe('LegacyDBLoader',()=>{
    describe('load',()=>{

  
        let loader;
        beforeEach( ()=>{
            loader = new RoutesLegacyDbLoader()                    
            
        })

        afterEach( ()=>{
            RoutesLegacyDbLoader['_instance'] = undefined
        })

        test('parsing descriptions',async ()=>{
            const routes:Array<Route> = []


            const videosRepo = JsonRepository.create('videos')
            const routesRepo = JsonRepository.create('routes')
    
            videosRepo.read = jest.fn().mockResolvedValue(videosData)
            routesRepo.read = jest.fn().mockResolvedValue(routesData)
    

            await new Promise(done=>{
                loader.load()
                    .on('route.added', route=>{routes.push(route)})
                    .on('done',done)}
                )
            
            expect(routes.length).toBe(34)
            expect(routes.map(r=>r.description)).toMatchSnapshot()
        })

    })

})