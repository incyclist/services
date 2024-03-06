import routesData from '../../../../__tests__/data/db/routes.json';
import videosData from '../../../../__tests__/data/db/videos.json';
import sydney from '../../../../__tests__/data/routes/sydney.json'
import holzweiler from '../../../../__tests__/data/rlv/holzweiler.json'
import valdrome from '../../../../__tests__/data/rlv/valdrome.json'

import repoData from '../../../../__tests__/data/db/db.json'
import {  JsonRepository } from '../../../api';
import { Countries } from '../../../i18n/countries';
import { Route } from "../../base/model/route";
import { RoutesDbLoader } from './db';
import { RouteInfo } from '../../base/types';
import { RoutesLegacyDbLoader } from './LegacyDB';
import { JSONObject } from '../../../utils/xml';

class MockRepository extends JsonRepository {
    static create(repoName:string):JsonRepository {
        return super.create(repoName)
    }
    static reset() {
        JsonRepository._instances = {}
        
    }
}


async function dbTest(loader: RoutesDbLoader, routes: Route[],id:string, t:'video'|'gpx' = 'gpx', legacy:boolean=false) {
    const videosRepo = MockRepository.create('videos');
    const routesRepo = MockRepository.create('routes');


    const countries = new Countries();
    countries.getIsoFromLatLng = jest.fn().mockResolvedValue('AU');
    const type = t||'gpx'

    videosRepo['id'] = `${type}-${id}`
    routesRepo['id'] = `${type}-${id}`

    videosRepo.read = jest.fn(async (file) => {
        if (file === 'routes') {
            const route = type==='video' ? videosData.find(r => r.id === id) : undefined;
            return [route] as unknown as JSONObject;
        }
        if (file === id && !legacy)
            return holzweiler as JSONObject;
        if (file === id && legacy)
            return valdrome as unknown as JSONObject

        return null as unknown as JSONObject;

    });

    routesRepo.read = jest.fn(async (file) => {
        if (file === 'db') {
            if (legacy) return null as unknown as JSONObject;

            const route = repoData.find(r => r.id === id);
            return [route] as unknown as JSONObject;
        }


        if (file === 'routes') {            
            const route = type==='gpx' ? routesData.find(r => r.id === id) : undefined;
            return [route] as unknown as JSONObject;
        }
        if (file === id)
            return sydney;

        return null as unknown as JSONObject;
    });

    routesRepo.write = jest.fn();


    
    await new Promise(done => {
        loader.load()
            .on('route.added', route => { 
                routes.push(route); 
            })
            .on('route.updated', done)
            .on('done', () => {                 
                setTimeout(done, 100); 
            });           
    });

    videosRepo.read = jest.fn()
    routesRepo.read = jest.fn()

}






describe('LegacyDBLoader',()=>{
    describe('load',()=>{

  
        let loader:RoutesDbLoader;
        let loaderObj 
        let legacy;
        beforeEach( ()=>{
            loader = loaderObj = new RoutesDbLoader()                    
            legacy = new RoutesLegacyDbLoader()
            
        })

        afterEach( ()=>{
            // cleanup Singletons
            loaderObj.reset()            
            legacy.reset()
            MockRepository.reset()
        })

        test('GPX File from Legacy',async ()=>{
            
            
            const routes:Array<Route> = []
            await dbTest(loader, routes,'5c7a6ae31b1bef04c5854cb3','gpx',true);            

            expect(routes.length).toBe(1)
            
            const descr = routes[0].description
            expect(descr.country).toBe('AU')
            expect(descr.isLoop).toBe(true)
            expect(descr.isLocal).toBe(false)
            
            
        })



        test('GPX File from DB',async ()=>{
            const routes:Array<Route> = []

            await dbTest(loader, routes,'5c7a6ae31b1bef04c5854cb3');            
            expect(routes.length).toBe(1)
            
            const descr = routes[0].description
            expect(descr.country).toBe('AU')
            expect(descr.isLoop).toBe(true)
            expect(descr.isLocal).toBe(false)
            expect(routes[0]).toMatchSnapshot()

            loaderObj = {...loader}
            expect(loaderObj['loadObserver'] ).toBeUndefined()

        })

        test('Local GPX File from DB',async ()=>{
            const routes:Array<Route> = []

            await dbTest(loader, routes,'9b779bbc-7a20-44f9-b490-76eecac34ee9');            
            expect(routes.length).toBe(1)
            
            const descr = routes[0].description
            expect(descr.country).toBe('ES')
            
            expect(descr.isLocal).toBe(true)
            //expect(routes[0]).toMatchSnapshot()            
        })

        test('Local Video File from DB',async ()=>{
            const routes:Array<Route> = []

            const id = '021dd6dd-c08b-431f-a888-2cd3183b1911'
            const before = {...repoData.find( d=>d.id===id)} as RouteInfo

            await dbTest(loader, routes,id,'video');            
            expect(routes.length).toBe(1)
            
            const descr = routes[0].description
            expect(descr.points).toBeDefined()

            if (!before.points)
                delete descr.points
            
            expect(routes[0].description).toMatchObject(before)            
        })

        test('Video File from Legacy',async ()=>{
            const routes:Array<Route> = []

            
            const id = 'a07c62c0-61a0-4f81-b55f-e743b9245006'
            const before = {...repoData.find( d=>d.id===id)} as RouteInfo
            delete before.previewUrl

            await dbTest(loader, routes,id,'video',true);            
            expect(routes.length).toBe(1)
            
            const descr = routes[0].description
            expect(descr.points).toBeDefined()
            expect(descr.legacyId).toBeDefined()



            if (!before.points)
                delete descr.points
            descr['routeId'] = descr.id
            descr.id = descr.legacyId
            delete descr.legacyId
            
            expect(routes[0].description).toMatchObject({...before,isLoop:true,next:'3aefb91a-be3e-42c1-b7cb-47bc80bebce5'})            
        })


        test('Downloadable Video File from DB',async ()=>{
            const routes:Array<Route> = []

            const id = '8ec98050-9bee-4e76-9a9f-e0c2ab1756f3'

            await dbTest(loader, routes,id,'video');            
            expect(routes.length).toBe(1)
            
            const descr = routes[0].description
            expect(descr.points).toBeDefined()

          
        })


    })

})

