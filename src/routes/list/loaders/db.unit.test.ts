
import {  JsonRepository } from '../../../api';
import { Countries } from '../../../i18n/countries';
import { Route } from "../../base/model/route";
import { RoutesDbLoader } from './db';
import { RouteInfo } from '../../base/types';
import { RoutesLegacyDbLoader } from './LegacyDB';
import { JSONObject } from '../../../utils/xml';
import { waitNextTick } from '../../../utils';
import clone from '../../../utils/clone';

import routesData from '../../../../__tests__/data/db/routes.json';
import videosData from '../../../../__tests__/data/db/videos.json';
import sydney from '../../../../__tests__/data/routes/sydney.json'
import holzweiler from '../../../../__tests__/data/rlv/holzweiler.json'
import valdrome from '../../../../__tests__/data/rlv/valdrome.json'
import repoData from '../../../../__tests__/data/db/db.json'
import { sleep } from '../../../utils/sleep';

class MockRepository extends JsonRepository {
    static create(repoName:string):JsonRepository {
        return super.create(repoName)
    }
    static reset() {
        JsonRepository._instances = {}
        
    }
}

let videosRepo:MockRepository
let routesRepo:MockRepository

const setSingleRouteMockRepo = (id:string, t:'video'|'gpx' = 'gpx', legacy:boolean=false) => {

    videosRepo = MockRepository.create('videos');
    routesRepo = MockRepository.create('routes');

    const countries = new Countries();
    countries.getIsoFromLatLng = jest.fn().mockResolvedValue('AU');
    const type = t||'gpx'

    videosRepo['id'] = `${type}-${id}`
    routesRepo['id'] = `${type}-${id}`

    routesRepo.write = jest.fn();
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

}

const setupMockRepo = (data=repoData) => {

    videosRepo = MockRepository.create('videos');
    routesRepo = MockRepository.create('routes');

    const countries = new Countries();
    countries.getIsoFromLatLng = jest.fn().mockResolvedValue('AU');

    videosRepo.read = jest.fn(async (file) => {
        if (file === 'routes') {
            return videosData as unknown as JSONObject;
        }
        return holzweiler as JSONObject;
    });

    routesRepo.read = jest.fn(async (file) => {
        if (file === 'db') {
            return data as unknown as JSONObject;
        }


        if (file === 'routes') {            
            return null as unknown as JSONObject;
        }
        return sydney as unknown as JSONObject;
    });

    routesRepo.write = jest.fn()
    routesRepo.delete = jest.fn()

    videosRepo.write = jest.fn()
    videosRepo.delete = jest.fn()

}

const run = async (loader,routes)=>{
    await new Promise(done => {

        const observer = loader.load()
        
        observer
            .on('route.added', route => { 
                routes.push(route); 
            })
            .on('route.updated', route => {
                const idx = routes.findIndex(r=>r.description.id===route.description.id)
                if (idx==-1)
                    routes.push(route)
                routes[idx] = route
            })
            .on('done', () => {                 
                waitNextTick().then( ()=>{
                    observer.stop()
                    done(routes)
                })
            });           
    });
}




describe('RoutesDbLoader',()=>{
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
            await setSingleRouteMockRepo('5c7a6ae31b1bef04c5854cb3','gpx',true);            
            await run(loader,routes)

            expect(routes.length).toBe(1)
            
            const descr = routes[0].description
            expect(descr.country).toBe('AU')
            expect(descr.isLoop).toBe(true)
            expect(descr.isLocal).toBe(false)
            
            
        })



        test('GPX File from DB',async ()=>{
            const routes:Array<Route> = []

            await setSingleRouteMockRepo('5c7a6ae31b1bef04c5854cb3');            
            await run(loader,routes)
            expect(routes.length).toBe(1)
            
            const descr = routes[0].description
            expect(descr.country).toBe('AU')
            expect(descr.isLoop).toBe(true)
            expect(descr.isLocal).toBe(false)

            expect(routes[0].description.tsImported).toBeDefined()
            delete routes[0].description.tsImported
            expect(routes[0]).toMatchSnapshot()

            loaderObj = {...loader}
            expect(loaderObj['loadObserver'] ).toBeUndefined()

        })

        test('Local GPX File from DB',async ()=>{
            const routes:Array<Route> = []

            await setSingleRouteMockRepo('9b779bbc-7a20-44f9-b490-76eecac34ee9');            
            await run(loader,routes)
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

            await setSingleRouteMockRepo(id,'video');            
            await run(loader,routes)

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

            await setSingleRouteMockRepo(id,'video',true);            
            await run(loader,routes)

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

            await setSingleRouteMockRepo(id,'video');            
            await run(loader,routes)

            expect(routes.length).toBe(1)
            
            const descr = routes[0].description
            expect(descr.points).toBeDefined()

          
        })

        test('repo with gpx and videos',async ()=>{
            const routes:Array<Route> = []

            const write = loaderObj.write = jest.fn( ()=>{ 
                // do nothing
            })
            loaderObj.writeDetails = jest.fn()

            const save = jest.spyOn(loader,'save')
            setupMockRepo()
            await run(loader,routes)
            expect(routes.length).toBe(34)
            expect(write).toHaveBeenCalledTimes(1)
            expect(save).toHaveBeenCalledTimes(0)
        })



    })

    describe( 'save',()=>{

        let loader:RoutesDbLoader;
        let loaderObj 
        let routes:Array<Route> 
        beforeEach( async ()=>{
            loader = loaderObj = new RoutesDbLoader()                    
            routes= []

            const data = clone(repoData)
            setupMockRepo(data)

            await run(loader,routes)

            jest.clearAllMocks()
            
        })

        afterEach( ()=>{
            // cleanup Singletons
            loaderObj.reset()            
            MockRepository.reset()
        })

        test('modifying content will update the repo',async ()=>{
            // modify route
            const dlRoute:Route = routes.find( r=>r.description.requiresDownload) as Route

            dlRoute.description.isDownloaded = true
            const write = loaderObj.write= jest.fn()

            await loader.save( dlRoute, false)
            expect(write).toHaveBeenCalledTimes(1)

            // no change: subsequent save() will not update repo
            await loader.save( dlRoute, false)
            expect(write).toHaveBeenCalledTimes(1)

            // next change: subsequent save() does update repo again
            dlRoute.description.isDownloaded = false
            await loader.save( dlRoute, false)
            expect(write).toHaveBeenCalledTimes(2)

        })

    })

    describe( 'delete',()=>{

        let loader:RoutesDbLoader;
        let loaderObj 
        let routes:Array<Route> 
        beforeEach( async ()=>{
            loader = loaderObj = new RoutesDbLoader()                    
            routes= []

            const data = clone(repoData)
            setupMockRepo(data)

            await run(loader,routes)

            jest.clearAllMocks()
            if (loaderObj.saveObserver)
                    loaderObj.saveObserver.stop()
            delete loaderObj.saveObserver
            
        })

        afterEach( ()=>{
            // cleanup Singletons
            loaderObj.reset()            
            MockRepository.reset()
        })

        test('delete video',async ()=>{
            // modify route
            const route = routes.find( r=>r.description.hasVideo) as Route

            console.log(route.description.title)
            await loader.delete( route)
            
            expect(routesRepo.write).toHaveBeenCalledTimes(1)   // update routes DB

            expect(videosRepo.write).toHaveBeenCalledTimes(0)   // nothing to save
            expect(videosRepo.delete).toHaveBeenCalledTimes(1)  // route has been deleted in details DB
            expect(routesRepo.delete).toHaveBeenCalledTimes(0)  // nothing to do here

        })

        test('delete GPX',async ()=>{
            // modify route
            const route = routes.find( r=>!r.description.hasVideo) as Route

            console.log(route.description.title)
            await loader.delete( route)
            
            expect(routesRepo.write).toHaveBeenCalledTimes(1)   // update routes DB

            expect(routesRepo.delete).toHaveBeenCalledTimes(1)  // route has been deleted in details DB
            expect(videosRepo.delete).toHaveBeenCalledTimes(0)  // nothing to do here

        })

    })

    describe('getDetails',()=>{

        let loader:RoutesDbLoader;
        let loaderObj 
        let legacy;
        let route
        let log

        const expectLog  = (message,reason,additional={}) => {
            expect(log).toHaveBeenCalledWith(expect.objectContaining({message, reason, ...additional}))
        }

        beforeEach( ()=>{
            loader = loaderObj = new RoutesDbLoader()                    
            legacy = new RoutesLegacyDbLoader()

            const data = clone(repoData)            
            setupMockRepo(data)

            const routeInfo = data[19]
            route = new Route(routeInfo) // Holzweiler
            loader.getDescription = jest.fn().mockReturnValue(route)

            loaderObj.logger.logEvent = log = jest.fn()

            
        })

        afterEach( ()=>{
            // cleanup Singletons
            loaderObj.reset()            
            legacy.reset()
            MockRepository.reset()
        })

        test('no legacy: data available',async ()=>{
            videosRepo.read = jest.fn().mockResolvedValue(holzweiler)
            const details = await loader.getDetails(route.description.id)
            expect(details).toBeDefined()
            expect(route.description.originalName).toBe('DE_Holzweiler-Keyenberg')
            expect(route.details).not.toBeDefined()

        })
        test('no legacy: no data available',async ()=>{
            videosRepo.read = jest.fn().mockResolvedValue(null)
            const details = await loader.getDetails(route.description.id)
            expect(details).toBeUndefined()
            expectLog('could not load route details','no data received')
        })
        test('no legacy: error when trying to load from repo',async ()=>{
            videosRepo.read = jest.fn().mockRejectedValue(new Error('some error'))
            const details = await loader.getDetails(route.description.id)
            expect(details).toBeUndefined()
            expectLog('could not load route details','some error')
        })

        test('legacy: data available',async ()=>{
            videosRepo.read = jest.fn().mockResolvedValue(holzweiler)
            route.description.legacyId = 'legacy-123'

            const details = await loader.getDetails(route.description.id)
            expect(videosRepo.read).toHaveBeenCalledWith('legacy-123')
            expect(videosRepo.read).not.toHaveBeenCalledWith(route.description.id)

            expect(details).toBeDefined()
            expect(route.description.originalName).toBe('DE_Holzweiler-Keyenberg')
            expect(route.details).not.toBeDefined()
        })

        test('legacy: no legacy data available, but real details available',async ()=>{
            videosRepo.read = jest.fn(  async (id:string) => {
                if (id==='legacy-123') return null as unknown as JSONObject
                return holzweiler as JSONObject
            })
            route.description.legacyId = 'legacy-123'
            const details = await loader.getDetails(route.description.id)
            expect(videosRepo.read).toHaveBeenCalledWith('legacy-123')
            expect(videosRepo.read).toHaveBeenCalledWith(route.description.id)

            expect(details).toBeDefined()
            expect(route.description.originalName).toBe('DE_Holzweiler-Keyenberg')
            expect(route.details).not.toBeDefined()
        })

        test('legacy: no legacy data available, and no real details available',async ()=>{
            videosRepo.read = jest.fn().mockRejectedValue( new Error('some error'))
            route.description.legacyId = 'legacy-123'
            const details = await loader.getDetails(route.description.id)
            expect(videosRepo.read).toHaveBeenCalledWith('legacy-123')
            expect(videosRepo.read).toHaveBeenCalledWith(route.description.id)

            expect(details).toBeUndefined()
            expectLog('could not load route details','some error')
        })

    })

})

