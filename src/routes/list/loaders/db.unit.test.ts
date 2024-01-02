import routesData from '../../../../__tests__/data/db/routes.json';
import videosData from '../../../../__tests__/data/db/videos.json';
import sydney from '../../../../__tests__/data/routes/sydney.json'
import holzweiler from '../../../../__tests__/data/rlv/holzweiler.json'
import repoData from '../../../../__tests__/data/db/db.json'
import { JSONObject, JsonRepository } from '../../../api';
import { Countries } from '../../../i18n/countries';
import { Route } from "../../base/model/route";
import { RoutesDbLoader } from './db';
import { RouteInfo } from '../../base/types';

async function dbTest(loader: RoutesDbLoader, routes: Route[],id:string, type:'video'|'gpx' = 'gpx') {
    const videosRepo = JsonRepository.create('videos');
    const routesRepo = JsonRepository.create('routes');
    const countries = new Countries();
    countries.getIsoFromLatLng = jest.fn().mockResolvedValue('AU');

    videosRepo.read = jest.fn(async (file) => {
        if (file === 'videos') {
            const route = type==='video' ? videosData.find(r => r.id === id) : undefined;
            return [route] as unknown as JSONObject;
        }
        if (file === id)
            return holzweiler as JSONObject;

        return null as unknown as JSONObject;

    });

    routesRepo.read = jest.fn(async (file) => {
        if (file === 'db') {
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
            .on('route.added', route => { routes.push(route); })
            .on('route.updated', done)
            .on('done', () => { setTimeout(done, 1000); });
    });
}


describe('LegacyDBLoader',()=>{
    describe('load',()=>{

  
        let loader:RoutesDbLoader;
        beforeEach( ()=>{
            loader = new RoutesDbLoader()                    
            
        })

        afterEach( ()=>{
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (loader as any).reset()
        })

        test('GPX File from Legacy',async ()=>{
            const routes:Array<Route> = []

            const videosRepo = JsonRepository.create('videos')
            const routesRepo = JsonRepository.create('routes')
            const countries = new Countries()
            countries.getIsoFromLatLng = jest.fn().mockResolvedValue('AU')
    
            videosRepo.read = jest.fn( async file=> {
                if (file==='videos')
                    return [] as JSONObject
                return null as unknown as JSONObject

            })

            routesRepo.read = jest.fn( async file =>{
                if (file==='db')
                    return null as unknown as JSONObject
                if (file==='routes') {
                    const route = routesData.find( r=>r.id==='5c7a6ae31b1bef04c5854cb3') 
                    return [route] as unknown as JSONObject
                }
                if (file==='5c7a6ae31b1bef04c5854cb3')
                    return sydney

                return null as unknown as JSONObject
            })

            routesRepo.write = jest.fn()
    

            await new Promise(done=>{
                loader.load()
                    .on('route.added', route=>{routes.push(route)})
                    .on('route.updated', done)
                    .on('done',()=>{setTimeout(done,1000)})
            })
            
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

