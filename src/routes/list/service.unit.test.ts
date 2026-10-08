import { RoutesDbLoader } from "./loaders/db";
import repoData from '../../../__tests__/data/db/db.json'
import { RouteInfoDBEntry } from "./loaders/types";
import { RouteListService } from "./service";
import { JsonAccess, getBindings } from "../../api";
import path from "path";
import os from "os"
import { IAppInfo } from "../../api/appInfo";
import fs from 'fs/promises'
import { IFileSystem } from "../../api/fs";
import { Route } from "../base/model/route";
import { RouteCard } from "./cards/RouteCard";
import { RouteParser } from "../base/parsers";
import { RouteApiDetail } from "../base/api/types";
import { RouteInfo } from "../base/types";
import { Observer } from "../../base/types/observer";
import { useUserSettings } from "../../settings";
import { Card } from "../../base/cardlist";
import { Inject } from "../../base/decorators";
import { usePreviewStore } from "../previews/store";
import { useRouteLibraryScanner } from "../library/service";
import { RouteListObserver } from "./RouteListObserver";

import type { ParseResult } from "../types";


let cnt = 0

class MockeableService extends RouteListService {
    public id :number

    constructor(data?:Array<RouteInfoDBEntry>) {
        super()
        this.id = ++cnt;
        if (data) {
            this.loadRoutes = jest.fn()
            this.routes = data.map( ri=> {
                const route = new Route( ri)
                const list = this.selectList(route)
                const card = new RouteCard(route,{list})
                list.add( card as Card<Route>)
                if ( list.getId()==='myRoutes')
                    card.enableDelete(true)    
                        
                return route
            } )
            this.initialized = true;
            
        }
    }

    public async loadRoutesFromApi(): Promise<void> {
        return await super.loadRoutesFromApi()
    }
}

const prepareMock = ( database, props) => {
    const data = repoData as unknown as Array<RouteInfoDBEntry>

    const {mockLoad=false} = props||{}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = new RoutesDbLoader()     as any
    db.loadDetails = jest.fn().mockResolvedValue({})
    db.loadDescriptions = jest.fn().mockResolvedValue(data)
    db.write = jest.fn()
    db.isCompleted = jest.fn().mockReturnValue(true)

    

    let service;

    if (mockLoad) {
        db.load = jest.fn().mockResolvedValue(true)
        service = new MockeableService(data)            
    }
    else {
        service = new MockeableService()            
    }
    
    
    
    service.loadRoutesFromApi = jest.fn().mockResolvedValue([])
    service.updateRepoStats = jest.fn()


    const filesystem = fs as unknown as IFileSystem;

    filesystem.ensureDir = jest.fn()
    filesystem.existsFile = jest.fn().mockResolvedValue(true)
    
    getBindings().path = path;
    getBindings().fs = filesystem
    getBindings().video = {
        isScreenshotSuported:jest.fn().mockReturnValue(true),
        isConvertSuported:jest.fn().mockReturnValue(true),
        screenshot:jest.fn().mockResolvedValue('screenshot'),
        convert:jest.fn(),
        convertOnline:jest.fn()

    }
    const access:JsonAccess = {
        read:jest.fn(),
        write:jest.fn().mockResolvedValue(true),
        delete:jest.fn().mockResolvedValue(true),
        list:jest.fn().mockResolvedValue(null)
    }
    getBindings().db = {
        create:jest.fn().mockResolvedValue(access),
        get:jest.fn().mockResolvedValue(access),
        release:jest.fn().mockResolvedValue(true) ,
        getPath:jest.fn().mockResolvedValue('/tmp/test.json')   
        
    }

    getBindings().appInfo = {
        getAppDir:jest.fn().mockReturnValue(os.tmpdir()),
        getChannel: jest.fn().mockReturnValue('desktop')
    } as unknown as IAppInfo
    return service
}

describe('RouteListService',()=>{



    describe('preload',()=>{

        let db
        let service:MockeableService


        const AppStateMock = {
            setPersistedState:jest.fn()
        }

        const MockUserSettings = {
            get: jest.fn().mockReturnValue({}),
            getValue: jest.fn().mockReturnValue({}),
            set: jest.fn()
        }

        beforeEach(()=>{ 
            service = prepareMock(db,{mockLoad:false})
            Inject('AppState', AppStateMock)
            Inject('UserSettings', MockUserSettings)
        })

        afterEach( ()=>{
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (service as any).reset()
            db?.reset()
            
            Inject('AppState', null)
            Inject('UserSettings', null)

            jest.resetAllMocks()
        })

        test('1',async ()=>{

            const observer = service.preload()
            await observer.wait()

            const {routes} = service.search()
            expect(routes.length).toBe(34)

            // remove observer before we check the result against expectation
            // routes.forEach( r => {
            //     // eslint-disable-next-line @typescript-eslint/no-explicit-any
            //     const d = r as any
            //     d.observer?.stop({immediately:true})
            //     delete d?.observer
            // })
            //expect(routes.sort(sort)).toMatchObject(repoData.sort(sort))

        })


    })

    describe( 'getFiltersCountry',()=>{

        let service;

        beforeAll ( async ()=>{
            service = prepareMock(null,{mockLoad:true})
        })
        afterEach( ()=>{
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            service.reset()            
            
        })

        test('typical list',()=>{
            const countries = service.getFilterCountries()
            expect(countries).toEqual(['Unknown','Australia','Canada','France','Germany','Greece','Italy','Norway','Portugal','Spain'])

        })

        // regression test: filter options must narrow based on OTHER active filters,
        // not always be derived from the full unfiltered route list
        test('narrows to countries available under the other active filters',()=>{
            const countries = service.getFilterCountries({contentType:'Video'})
            expect(countries).not.toContain('Australia')
            expect(countries).not.toContain('Canada')
            expect(countries).toContain('France')
        })

        test('getFilterOptions passes filters through to each dimension',()=>{
            const {countries} = service.getFilterOptions({contentType:'Video'})
            expect(countries).not.toContain('Australia')
            expect(countries).not.toContain('Canada')
        })

    })


    describe( 'search',()=>{

        let service;
        let userSettings

        beforeEach(async ()=>{ 
            userSettings = useUserSettings()
            userSettings.get = jest.fn().mockReturnValue({})
            userSettings.set = jest.fn()
            service.filters = undefined
            await service.preload().wait()

        })

        afterEach( ()=>{
            userSettings?.reset()
        })

        beforeAll ( async ()=>{
            service = prepareMock(null,{mockLoad:true})
        })

        test('country filter',()=>{
            const {routes} = service.search({country:'Australia'})
            expect(routes.length).toBe(2)
            expect(routes.map(r=>r.title)).toEqual( ['Captain  Cook Highway','Sydney Opera House and Botanic Garden'])    
        })

        test('title filter',()=>{
            const {routes} = service.search({title:'Sydney'})
            expect(routes.length).toBe(1)
            expect(routes.map(r=>r.title)).toEqual( ['Sydney Opera House and Botanic Garden' ])    
        })
        test('min distance filter',()=>{
            const {routes} = service.search({distance:{min:100000}})
            expect(routes.length).toBe(2)
            expect(routes.map(r=>r.id)).toEqual( ['20b1ba7a-93c6-4ce3-aafa-f9d24325c7be','9b779bbc-7a20-44f9-b490-76eecac34ee9' ])    
        })
        test('max distance filter',()=>{
            const {routes} = service.search({distance:{max:3000}})
            
            expect(routes.map(r=>r.title)).toEqual( ['Corvara','Menorca West','Trollstigen' ])    
        })
        test('min elevation filter',()=>{
            const {routes} = service.search({elevation:{min:2000}})
            expect(routes.map(r=>r.title)).toEqual( ['Visiting Jeroen - Part 14' ])    
        })
        test('max elevation filter',()=>{
            const {routes} = service.search({elevation:{max:1}})
            expect(routes.map(r=>r.title)).toEqual( ['Ventoux - Malaucene','Würzjoch ' ])    
        })
        test('content type video',()=>{
            const {routes} = service.search({contentType:'Video'})
            expect(routes.length).toBe(25)
        })
        test('content type GPX',()=>{
            const {routes} = service.search({contentType:'GPX'})
            expect(routes.length).toBe(9)
        })
        test('route type Loop',()=>{
            const {routes} = service.search({routeType:'Loop'})
            expect(routes.length).toBe(7)
        })
        test('route type Point to Point',()=>{
            const {routes} = service.search({routeType:'Point to Point'})
            expect(routes.length).toBe(27)
        })

        test('title filter should be case insensitive',()=>{
            const {routes} = service.search({title:'sydney'})
            expect(routes.length).toBe(1)
            expect(routes.map(r=>r.title)).toEqual( ['Sydney Opera House and Botanic Garden' ])    
        })

        test('combinations',()=>{
            const {routes} = service.search({routeType:'Loop',elevation:{min:100}, contentType:'GPX'})
            expect(routes.map(r=>r.title)).toEqual( ['Malaga City Tour' ])    
        })
        test('no filters - initial search',()=>{
            const {routes} = service.search()
            expect(routes.length).toBe(34)
        })
        test('no filters - after previous search',()=>{
            const res = service.search({routeType:'Loop',elevation:{min:100}, contentType:'GPX'})
            const {routes} = service.search()
            expect(routes.length).toBe(1)
        })

    })

    describe('sort order',()=>{

        let service:MockeableService
        let settingsStore:Record<string,unknown>

        beforeEach(()=>{
            new RouteListService().reset()
            settingsStore = {}
            const MockUserSettings = {
                get: jest.fn((key:string, defValue?:unknown) => settingsStore[key] ?? defValue),
                getValue: jest.fn().mockReturnValue({}),
                set: jest.fn((key:string, value:unknown) => { settingsStore[key] = value }),
            }
            Inject('UserSettings', MockUserSettings)
            service = prepareMock(null,{mockLoad:true})
        })

        afterEach(()=>{
            (service as any).reset()
            Inject('UserSettings', null)
            jest.clearAllMocks()
        })

        test('defaults to Suggested, matching an explicit suggested sort order',()=>{
            // Suggested scores routes against the wall clock; freeze it so the two reads can't
            // straddle a recency boundary and reorder
            const now = Date.now()
            const nowSpy = jest.spyOn(Date,'now').mockReturnValue(now)
            try {
                const withDefault = service.searchRepo().routes.map(r=>r.id)

                service.setSortOrder('suggested')
                const withExplicit = service.searchRepo().routes.map(r=>r.id)

                expect(withDefault).toEqual(withExplicit)
            }
            finally {
                nowSpy.mockRestore()
            }
        })

        // a private, never-shared data set - unlike the module-level db.json fixture, whose route
        // objects other describe blocks mutate in place via checkUIUpdateWithNoRepoStats(). This
        // isolates the case to the one thing score() should reward here: hasVideo. The scorer's
        // other inputs (recency, novelty) are covered directly in lists/selected.unit.test.ts.
        test('Suggested ranks a video route above an otherwise identical GPX route',()=>{
            new RouteListService().reset()
            const customData = [
                { id:'g1', title:'GPX A', hasVideo:false, isLocal:false },
                { id:'v1', title:'Video A', hasVideo:true, isLocal:false },
            ] as unknown as Array<RouteInfoDBEntry>

            const custom = new MockeableService(customData)
            custom.setSortOrder('suggested')

            const {routes} = custom.searchRepo()

            expect(routes.map(r=>r.id)).toEqual(['v1','g1'])
        })

        test('Name (A-Z) sorts titles alphabetically',()=>{
            service.setSortOrder('name')
            const {routes} = service.searchRepo()

            const titles = routes.map(r=>r.title)
            expect(titles).toEqual([...titles].sort((a,b)=> a>b ? 1 : -1))
        })

        test('Distance sorts ascending by raw distance',()=>{
            service.setSortOrder('distance')
            const {routes} = service.searchRepo()

            const distances = routes.map(r=>r.distance ?? 0)
            expect(distances).toEqual([...distances].sort((a,b)=> a-b))
        })

        test('Elevation sorts ascending by raw elevation',()=>{
            service.setSortOrder('elevation')
            const {routes} = service.searchRepo()

            const elevations = routes.map(r=>r.elevation ?? 0)
            expect(elevations).toEqual([...elevations].sort((a,b)=> a-b))
        })

        test('typing in the search box does not change the sort order - only which routes survive',()=>{
            service.setSortOrder('distance')
            const all = service.searchRepo().routes.map(r=>r.id)

            const filtered = service.searchRepo({title:'a'}).routes.map(r=>r.id)

            // the filtered ids must keep the exact relative order they had in the unfiltered,
            // distance-sorted list - filtering can drop entries, it must never reorder them
            const positions = filtered.map(id => all.indexOf(id))
            expect(positions).toEqual([...positions].sort((a,b)=> a-b))
            expect(filtered.length).toBeGreaterThan(0)
            expect(filtered.length).toBeLessThan(all.length)
        })

    })

    describe('searchRepo caching',()=>{

        let service:MockeableService

        const MockUserSettings = {
            get: jest.fn().mockReturnValue({}),
            getValue: jest.fn().mockReturnValue({}),
            set: jest.fn()
        }

        beforeEach(()=>{
            // fresh singleton instance, isolated from the other describe blocks in this file
            new RouteListService().reset()
            Inject('UserSettings', MockUserSettings)
            service = prepareMock(null,{mockLoad:true})
        })

        afterEach(()=>{
            (service as any).reset()
            Inject('UserSettings', null)
            jest.restoreAllMocks()
        })

        test('a filter change reuses the cached display properties instead of recomputing them',()=>{
            service.search({title:'a'})

            const spy = jest.spyOn(RouteCard.prototype,'getDisplayProperties')
            service.search({title:'ab'})

            expect(spy).not.toHaveBeenCalled()
        })

        test('a card update recomputes only that card, and the next search() reflects it',async ()=>{
            const {routes:initial} = service.search()
            const target = initial[0]
            const card = service.getCard(target.id)

            const spy = jest.spyOn(RouteCard.prototype,'getDisplayProperties')

            await card.setActiveCount(7)

            const {routes:after} = service.search()
            const updated = after.find( r=>r.id===target.id)

            expect(updated.cntActive).toBe(7)
            // the only recompute is the one RouteCard.emitUpdate() performs itself to build the
            // event payload - searchRepo() serves the cache from that payload rather than asking
            // the card again
            expect(spy).toHaveBeenCalledTimes(1)
        })

    })

    describe('import',()=>{
        let service;
        let originalParser
        let originalReaddir
        let userSettings

        beforeAll ( async ()=>{
            service = prepareMock(null,{mockLoad:true})
        })

        beforeEach( ()=>{
            originalParser = RouteParser.parse
            userSettings = useUserSettings()
            userSettings.get = jest.fn().mockReturnValue({})
            userSettings.set = jest.fn()

            // a dropped route file is read the way the import dialog reads it: its folder is
            // listed first (companion files, video lookup)
            originalReaddir = getBindings().fs.readdir
            getBindings().fs.readdir = jest.fn().mockResolvedValue(['test1.xml','test2.xml'])
        })


        afterEach( ()=>{
            RouteParser.parse = originalParser
            getBindings().fs.readdir = originalReaddir
            service.reset()
            userSettings?.reset()


        })

        test('failed import, followed by successfull import',async ()=>{
            // a route read from a local file (every file parser sets isLocal)
            const data: RouteInfo = {  id:'test', title:'test', isLocal:true}
            const details: RouteApiDetail= {  id:'test', title:'test'}
            const result: ParseResult<RouteApiDetail> = { data,details}

            
            RouteParser.parse = jest.fn()
                .mockRejectedValueOnce( new Error('Some Error'))
                .mockResolvedValueOnce( result)

            service.cardObserver = new Observer()
            service.cardObserver.emit = jest.fn()

            await service.import( {type:'file', name:'test1.xml',filename:'/test1',dir:'/',ext:'xml', delimiter:'/'})
            await new Promise(resolve => setImmediate(resolve)) // import() is fire-and-forget per file
            let card2 = service.myRoutes.getCards()[2]
            expect(card2.getDisplayProperties()).toMatchObject({name:'test1.xml',error:expect.objectContaining({message:'Some Error'}),visible:true})

            await service.import( {type:'file', name:'test2.xml',filename:'/test2',dir:'/',ext:'xml', delimiter:'/'})
            await new Promise(resolve => setImmediate(resolve)) // import() is fire-and-forget per file
            card2 = service.myRoutes.getCards()[2]
            const card3 = service.myRoutes.getCards()[3]
            expect(card2.getDisplayProperties()).toMatchObject({name:'test1.xml',error:expect.objectContaining({message:'Some Error'}),visible:true})

            expect(card3.getDisplayProperties()).toMatchObject(expect.objectContaining({id:'test',title:'test',tsImported:expect.anything()}))

        })

        test('failed import, check that search still works',async ()=>{
            const data: RouteInfo = {  id:'test', title:'test', isLocal:true}
            const details: RouteApiDetail= {  id:'test', title:'test'}
            const result: ParseResult<RouteApiDetail> = { data,details}


            RouteParser.parse = jest.fn()
            .mockResolvedValueOnce( result)
            .mockRejectedValueOnce( new Error('Some Error'))

            service.cardObserver = new Observer()
            service.cardObserver.emit = jest.fn()

            // onse successfull import to populate the list
            await service.import( {type:'file', name:'test1.xml',filename:'/test1',dir:'/',ext:'xml', delimiter:'/'})
            await new Promise(resolve => setImmediate(resolve)) // import() is fire-and-forget per file

            // one failed import (2nd response to RouteParser.parse is configured to fail (see above) )
            await service.import( {type:'file', name:'test1.xml',filename:'/test1',dir:'/',ext:'xml', delimiter:'/'})
            await new Promise(resolve => setImmediate(resolve)) // import() is fire-and-forget per file

            const res = service.search()
            expect(res?.routes.length).toBeGreaterThan(0)



        })


    })

    describe('import - one single-route path for dropped and picked files',()=>{
        let service;
        let originalReaddir
        let userSettings

        const dropped = (name:string) => ({type:'url', url:`file:///routes/${name}`, name, dir:'/routes', ext:name.split('.').pop(), delimiter:'/'}) as any
        const activeImports = () => service.myRoutes.getCards().filter( c=>c.getCardType()==='ActiveImport')
        const flush = () => new Promise(resolve => setImmediate(resolve))

        beforeAll ( async ()=>{
            service = prepareMock(null,{mockLoad:true})
        })

        beforeEach( ()=>{
            userSettings = useUserSettings()
            userSettings.get = jest.fn().mockReturnValue({})
            userSettings.set = jest.fn()
            originalReaddir = getBindings().fs.readdir
        })

        afterEach( ()=>{
            Inject('RouteLibraryScanner', null)
            getBindings().fs.readdir = originalReaddir
            service.myRoutes.removeActiveImports()
            jest.restoreAllMocks()
            service.reset()
            userSettings?.reset()
        })

        test('a dropped file is imported by the scanner\'s single-route path, into this list',async ()=>{
            const importRouteFile = jest.fn().mockResolvedValue({})
            Inject('RouteLibraryScanner', { importRouteFile })
            const file = dropped('ride.gpx')

            service.import(file)
            expect(activeImports()).toHaveLength(1)
            await flush()

            expect(importRouteFile).toHaveBeenCalledWith(file, {list:service})
            expect(activeImports()).toHaveLength(0)
        })

        test('several dropped files: one pinned row each, all started at once, each removed when done',async ()=>{
            const pending: Array<(v:unknown)=>void> = []
            const importRouteFile = jest.fn( ()=> new Promise( resolve => { pending.push(resolve) }))
            Inject('RouteLibraryScanner', { importRouteFile })

            service.import([dropped('one.gpx'),dropped('two.gpx'),dropped('three.gpx')])

            expect(activeImports().map(c=>c.getDisplayProperties().name)).toEqual(['one.gpx','two.gpx','three.gpx'])
            expect(importRouteFile).toHaveBeenCalledTimes(3)

            pending[1]({})
            await flush()
            expect(activeImports().map(c=>c.getDisplayProperties().name)).toEqual(['one.gpx','three.gpx'])

            pending[0]({})
            pending[2]({})
            await flush()
            expect(activeImports()).toHaveLength(0)
        })

        test('a failed drop keeps its pinned row, showing the failure with its code',async ()=>{
            const failure = Object.assign(new Error('cannot parse <Track>'), {code:'PARSE_FAILED'})
            Inject('RouteLibraryScanner', { importRouteFile: jest.fn().mockRejectedValue(failure) })

            service.import(dropped('ride.gpx'))
            await flush()

            const [card] = activeImports()
            expect(card.getDisplayProperties().error).toBe(failure)
        })

        test.each([
            ['a missing companion file', ['a.epm'], 'a.epm', 'MISSING_COMPANION'],
            ['a file that is not a route file', ['a.epp'], 'a.epp', 'UNSUPPORTED'],
            ['a file that is not in its folder', ['b.epm','b.epp'], 'a.epm', 'READ_FAILED'],
        ])('%s: the same failure, with the same code and text, whether dropped or picked in the dialog', async (_, listing, name, code)=>{
            getBindings().fs.readdir = jest.fn().mockResolvedValue(listing)

            service.import(dropped(name))
            await flush()
            const dropError = activeImports()[0].getDisplayProperties().error

            const scanner = useRouteLibraryScanner()
            scanner.prepare()
            const observer = scanner.importSingle(dropped(name))
            await new Promise<void>(resolve => observer.once('error', ()=>resolve()))
            await flush()
            const {error, failure} = scanner.getDisplayProps()
            scanner.done()

            expect(dropError.code).toBe(code)
            expect(failure.code).toBe(code)
            expect(failure.reason).toBe(dropError.message)
            expect(error).toBe(dropError.message)
            expect(failure.missingExt).toBe(dropError.missingExt)
        })
    })

    describe('existsBySourceUri', () => {
        let service: MockeableService
        let dbSaveSpy: jest.SpyInstance

        beforeAll(() => {
            service = prepareMock(null, {mockLoad: true})
        })

        afterEach(() => {
            service.reset()
        })

        afterAll(() => {
            dbSaveSpy?.mockRestore()
        })

        test('returns false when no route has the given URI', async () => {
            const result = await service.existsBySourceUri('content://com.example/nonexistent')
            expect(result).toBe(false)
        })

        test('returns true when a route has a matching sourceTreeUri', async () => {

            const routes = (service as any).routes
            const last:Route = routes.at(-1)

            last.description.sourceTreeUri = 'content://com.example/tree/primary:MyRoutes'

            const result = await service.existsBySourceUri('content://com.example/tree/primary:MyRoutes')
            expect(result).toBe(true)
        })

    })

    describe('sync and stats subscriptions', () => {
        // RouteListService is a singleton: don't leave the observer set for the tests that expect none
        afterEach(() => {
            new MockeableService()['observer'] = undefined
        })

        test('a sync with no connected provider emits no sync-start that would never be closed', async () => {
            const service = new MockeableService()
            service['observer'] = new RouteListObserver(service)
            jest.spyOn(service as any, 'getRouteSyncFactory').mockReturnValue({ sync: () => null })

            const events: string[] = []
            service['observer'].on('sync-start', () => events.push('sync-start'))
            service['observer'].on('sync-done', () => events.push('sync-done'))

            await service['performSync']()
            expect(events).toEqual([])
        })

        test('subscribing to stats updates again does not add a second listener', () => {
            const service = new MockeableService()
            service['observer'] = new RouteListObserver(service)

            service['subscribeStats']()
            service['subscribeStats']()

            expect((service['observer'] as any).emitter.listenerCount('stats-update')).toBe(1)
        })
    })

    describe('select/unselect without observer', () => {
        test('select() should not throw when observer is not initialized', () => {
            const service = new MockeableService(repoData as any)
            const route = service['routes'][0]

            // observer is never initialized (no open() or searchRepo() call)
            expect(service['observer']).toBeUndefined()

            // Should not throw
            expect(() => service.select(route)).not.toThrow()
        })

        test('unselect() should not throw when observer is not initialized', () => {
            const service = new MockeableService(repoData as any)

            // observer is never initialized (no open() or searchRepo() call)
            expect(service['observer']).toBeUndefined()

            // Should not throw
            expect(() => service.unselect()).not.toThrow()
        })
    })

    describe('persisted view preferences', () => {
        let service: MockeableService
        let settingsStore: Record<string, unknown>
        // Recreated fresh in beforeEach (not a describe-scope constant) - an earlier describe's
        // jest.resetAllMocks() would otherwise strip a once-defined mock's implementation before
        // these tests ever run, since Jest's mock registry is shared across the whole file.
        let MockUserSettings: { get: jest.Mock, set: jest.Mock }

        beforeEach(() => {
            new RouteListService().reset()
            settingsStore = {}
            MockUserSettings = {
                get: jest.fn((key: string, defValue?: unknown) => settingsStore[key] ?? defValue),
                set: jest.fn((key: string, value: unknown) => { settingsStore[key] = value }),
            }
            Inject('UserSettings', MockUserSettings)
            service = new MockeableService()
        })

        afterEach(() => {
            Inject('UserSettings', null)
            jest.clearAllMocks()
        })

        describe('getListTop/setListTop', () => {
            test('round-trips a top position per display type', () => {
                service.setListTop('tiles', 250)
                service.setListTop('list', 40)

                expect(service.getListTop('tiles')).toBe(250)
                expect(service.getListTop('list')).toBe(40)
            })

            test('with no argument, defaults to the persisted display type - not an unset in-memory field', () => {
                settingsStore['preferences.routeListDisplayType'] = 'tiles'
                service.setListTop('tiles', 250)

                // setDisplayType() was never called in this session; getListTop() must still
                // resolve 'tiles' via the persisted preference rather than an unset field -
                // this is the mismatch that made tile view restore the list view's position.
                expect(service.getListTop()).toBe(250)
            })

            test('the single-argument (number) overload stores under the persisted display type', () => {
                settingsStore['preferences.routeListDisplayType'] = 'tiles'
                service.setListTop(99)

                expect(service.getListTop('tiles')).toBe(99)
                expect(service.getListTop('list')).toBeUndefined()
            })
        })

        describe('getSortOrder/setSortOrder', () => {
            test('defaults to suggested', () => {
                expect(service.getSortOrder()).toBe('suggested')
            })

            test('round-trips and persists to user settings', () => {
                service.setSortOrder('distance')

                expect(service.getSortOrder()).toBe('distance')
                expect(MockUserSettings.set).toHaveBeenCalledWith('preferences.routeListSortOrder', 'distance')
            })
        })

        describe('getFiltersExpanded/setFiltersExpanded', () => {
            test('defaults to collapsed', () => {
                expect(service.getFiltersExpanded()).toBe(false)
            })

            test('round-trips and persists to user settings', () => {
                service.setFiltersExpanded(true)

                expect(service.getFiltersExpanded()).toBe(true)
                expect(MockUserSettings.set).toHaveBeenCalledWith('preferences.routeListFiltersExpanded', true)
            })
        })
    })

    describe('previews', () => {

        // RouteListService and RouteCard are shared with desktop, where the fileAccess
        // binding does not exist: the preview paths must behave exactly as they always have.

        let service:MockeableService

        beforeEach(() => {
            new RouteListService().reset()
            service = prepareMock(null,{mockLoad:true})
            delete getBindings().fileAccess
        })

        afterEach(() => {
            (service as any).reset()
            ;(new RoutesDbLoader() as any).reset()
            usePreviewStore().reset()
            delete getBindings().fileAccess
        })

        const descr = (over:Partial<RouteInfo> = {}):RouteInfo =>
            ({ id:'1', title:'test', hasVideo:true, videoUrl:'/mnt/videos/a.mp4', ...over }) as RouteInfo

        describe('without the preview store (desktop)', () => {

            test('an existing preview next to the video becomes the previewUrl', async () => {
                const d = descr()

                const result = await (service as any).checkExistingPreviewFiles(d)

                expect(result).toBe('/mnt/videos/preview.png')
                expect(d.previewUrl).toBe('/mnt/videos/preview.png')
                expect(d.previewSource).toBeUndefined()
            })

            test('a file:/// video keeps the file URL spelling of the preview', async () => {
                const d = descr({ videoUrl:'file:///mnt/videos/a.mp4' })

                const result = await (service as any).checkExistingPreviewFiles(d)

                expect(result).toBe('file:///mnt/videos/preview.png')
            })

            test('a preview next to a video whose folder has a percent-encoded space is found (iCloud "Mobile Documents")', async () => {
                const d = descr({ videoUrl:'file:///private/var/mobile/Library/Mobile%20Documents/com~apple~CloudDocs/IncyclistTest/CH_Ofenpass/Ofenpass.mp4' })

                // only resolvable once the %20 has been decoded back to a real space - this fails
                // the way the original bug did if the candidate still contains a literal "%20"
                getBindings().fs.existsFile = jest.fn(async (candidate:string) =>
                    candidate.endsWith('Mobile Documents/com~apple~CloudDocs/IncyclistTest/CH_Ofenpass/Ofenpass_preview.png')
                )

                const result = await (service as any).checkExistingPreviewFiles(d)

                expect(result).toContain('Mobile Documents/com~apple~CloudDocs/IncyclistTest/CH_Ofenpass/Ofenpass_preview.png')
                expect(result).not.toContain('%20')
                expect(d.previewUrl).toBe(result)
            })

            test('a screenshot is created and used as-is', async () => {
                const d = descr({ videoUrl:'/mnt/videos/b.mp4' })
                getBindings().fs.existsFile = jest.fn().mockResolvedValue(false)

                const result = await (service as any).doCreatePreview(d)

                expect(getBindings().video.screenshot).toHaveBeenCalled()
                expect(result).toBe('screenshot')
                expect(d.previewUrl).toBe('screenshot')
            })
        })

        describe('with the preview store', () => {

            const createStoreMock = (over:any = {}) => ({
                isEnabled: () => true,
                adoptOnImport: jest.fn(),
                adoptGenerated: jest.fn(),
                isScreenshotAllowed: jest.fn().mockResolvedValue(true),
                ...over
            })

            test('a discovered preview is adopted instead of referenced', async () => {
                const d = descr()
                const store = createStoreMock({
                    adoptOnImport: jest.fn(async (target:RouteInfo) => {
                        target.previewUrl = 'file:///previews/route-1.png'
                    })
                })
                service.inject('PreviewStore', store)

                const result = await (service as any).checkExistingPreviewFiles(d)

                expect(store.adoptOnImport).toHaveBeenCalledWith(d, '/mnt/videos/preview.png')
                expect(result).toBe('file:///previews/route-1.png')
            })

            test('a preview that could not be copied leaves the fallback in place', async () => {
                const d = descr()
                const store = createStoreMock({
                    adoptOnImport: jest.fn(async (target:RouteInfo) => {
                        target.previewUrl = undefined
                        target.previewSource = '/mnt/videos/preview.png'
                    })
                })
                service.inject('PreviewStore', store)

                const result = await (service as any).checkExistingPreviewFiles(d)

                expect(result).toBeUndefined()
                expect(d.previewUrl).toBeUndefined()
                expect(d.previewSource).toBe('/mnt/videos/preview.png')
            })

            test('no screenshot is taken from a video that is not available locally', async () => {
                const d = descr({ videoUrl:'/mnt/videos/b.mp4' })
                getBindings().fs.existsFile = jest.fn().mockResolvedValue(false)
                const store = createStoreMock({ isScreenshotAllowed: jest.fn().mockResolvedValue(false) })
                service.inject('PreviewStore', store)

                const result = await (service as any).doCreatePreview(d)

                expect(result).toBeUndefined()
                expect(getBindings().video.screenshot).not.toHaveBeenCalled()
                expect(d.previewUrl).toBeUndefined()
            })

            test('a generated thumbnail is moved into the store', async () => {
                const d = descr({ videoUrl:'/mnt/videos/b.mp4' })
                getBindings().fs.existsFile = jest.fn().mockResolvedValue(false)
                const store = createStoreMock({
                    adoptGenerated: jest.fn(async (target:RouteInfo) => {
                        target.previewUrl = 'file:///previews/route-1.png'
                    })
                })
                service.inject('PreviewStore', store)

                const result = await (service as any).doCreatePreview(d)

                expect(store.adoptGenerated).toHaveBeenCalledWith(d, 'screenshot')
                expect(result).toBe('file:///previews/route-1.png')
            })
        })
    })

    describe('route shape', () => {

        let service:MockeableService
        let card: { emitUpdate: jest.Mock }

        beforeEach(() => {
            new RouteListService().reset()
            service = prepareMock(null,{mockLoad:true})
            card = { emitUpdate: jest.fn() }
            ;(service as any).getCard = jest.fn(() => card)
        })

        afterEach(() => {
            (service as any).reset()
            Inject('RouteShapeStore', null)
        })

        describe('backfillRouteShape', () => {

            test('does nothing for a route whose details are not loaded', () => {
                const store = { get: jest.fn(), backfill: jest.fn() }
                service.inject('RouteShapeStore', store)

                ;(service as any).backfillRouteShape({ description:{id:'1'} })

                expect(store.backfill).not.toHaveBeenCalled()
            })

            test('does nothing when a shape is already resident', () => {
                const store = { get: jest.fn().mockReturnValue([{routeDistance:0}]), backfill: jest.fn() }
                service.inject('RouteShapeStore', store)

                ;(service as any).backfillRouteShape({ description:{id:'1'}, details:{} })

                expect(store.backfill).not.toHaveBeenCalled()
            })

            test('backfills and updates the card once a shape becomes available', async () => {
                const store = { get: jest.fn().mockReturnValue(undefined), backfill: jest.fn().mockResolvedValue(true) }
                service.inject('RouteShapeStore', store)
                const route = { description:{id:'1'}, details:{} }

                ;(service as any).backfillRouteShape(route)
                await new Promise(resolve => setImmediate(resolve))

                expect(store.backfill).toHaveBeenCalledWith(route)
                expect(card.emitUpdate).toHaveBeenCalled()
            })

            test('does not update the card when no shape could be produced', async () => {
                const store = { get: jest.fn().mockReturnValue(undefined), backfill: jest.fn().mockResolvedValue(false) }
                service.inject('RouteShapeStore', store)

                ;(service as any).backfillRouteShape({ description:{id:'1'}, details:{} })
                await new Promise(resolve => setImmediate(resolve))

                expect(card.emitUpdate).not.toHaveBeenCalled()
            })

            test('a rejecting store does not throw', async () => {
                const store = { get: jest.fn().mockReturnValue(undefined), backfill: jest.fn().mockRejectedValue(new Error('disk full')) }
                service.inject('RouteShapeStore', store)

                expect(() => (service as any).backfillRouteShape({ description:{id:'1'}, details:{} })).not.toThrow()
                await new Promise(resolve => setImmediate(resolve))

                expect(card.emitUpdate).not.toHaveBeenCalled()
            })
        })

        describe('loadRouteShape', () => {

            test('returns a resident shape without reading the repository', async () => {
                const shape = [{routeDistance:0}]
                const store = { get: jest.fn().mockReturnValue(shape), load: jest.fn() }
                service.inject('RouteShapeStore', store)

                const result = await service.loadRouteShape('1')

                expect(result).toBe(shape)
                expect(store.load).not.toHaveBeenCalled()
            })

            test('reads the repository and updates the card when the shape becomes resident', async () => {
                const shape = [{routeDistance:0}]
                const store = { get: jest.fn().mockReturnValue(undefined), load: jest.fn().mockResolvedValue(shape) }
                service.inject('RouteShapeStore', store)

                const result = await service.loadRouteShape('1')

                expect(result).toBe(shape)
                expect(card.emitUpdate).toHaveBeenCalled()
            })

            test('does not update the card when no shape is stored', async () => {
                const store = { get: jest.fn().mockReturnValue(undefined), load: jest.fn().mockResolvedValue(undefined) }
                service.inject('RouteShapeStore', store)

                const result = await service.loadRouteShape('1')

                expect(result).toBeUndefined()
                expect(card.emitUpdate).not.toHaveBeenCalled()
            })

            test('a rejecting store resolves to undefined rather than throwing', async () => {
                const store = { get: jest.fn().mockReturnValue(undefined), load: jest.fn().mockRejectedValue(new Error('disk full')) }
                service.inject('RouteShapeStore', store)

                await expect(service.loadRouteShape('1')).resolves.toBeUndefined()
            })
        })
    })

    describe('preloadDetails - auto-undo missing download', () => {
        // A route marked as downloaded whose local video file no longer exists
        // (deleted outside the app, or - historically - deleted moments after
        // completion by a third-party download library bug) should self-heal
        // back to the same state as the user-triggered "delete downloaded
        // video" action: streamable from its original remote URL again, and
        // re-downloadable. preloadDetails() is the async hot path that already
        // runs for every route on load and already has direct RouteCard access,
        // so that's where the check is hooked in.

        let service:MockeableService

        const flushPromises = () => new Promise(resolve => setImmediate(resolve))

        beforeEach(() => {
            // RouteListService is a Singleton, and some sibling describe blocks
            // in this file construct/mutate it without resetting afterward -
            // force a clean slate regardless of what ran before this block, so
            // this describe's own card-count assertions aren't at the mercy of
            // sibling test ordering/cleanup.
            new RouteListService().reset()
            service = prepareMock(null,{mockLoad:true})
            // Suggested (score-based) is the default sort order since the sort-order feature
            // landed - pin this describe back to Name (A-Z) so primeCard()'s "retitle to sort
            // first" trick still guarantees preloadDetails()'s preload cap picks up the route
            // this describe mutates, regardless of the default sort order in effect elsewhere.
            // Set directly rather than via setSortOrder(), which persists through the real
            // (here uninitialized) UserSettingsService - this describe injects no settings mock.
            ;(service as any).sortOrder = 'name'
        })

        afterEach(() => {
            (service as any).reset()
            ;(new RoutesDbLoader() as any).reset()
        })

        // Mutates an existing (real fixture) route/card in place, rather than
        // injecting new data - prepareMock() always builds from the fixture.
        // Retitling it to sort first alphabetically guarantees it's inside
        // preloadDetails()'s preload cap (PRELOAD_DESKTOP/PRELOAD_MOBILE)
        // regardless of the other ~34 fixture titles.
        const primeCard = (overrides:Partial<RouteInfo>):RouteCard => {
            const route = service['routes'][0]
            Object.assign(route.description, { title:'0-auto-undo-test-route' }, overrides)
            return service.getCard(route.description.id)
        }

        test('resets the download when a downloaded video route\'s file no longer exists',async () => {
            const card = primeCard({ hasVideo:true, isDownloaded:true })
            card.videoExists = jest.fn().mockResolvedValue(false)
            card.resetDownload = jest.fn().mockResolvedValue(undefined)

            await (service as any).preloadDetails()
            await flushPromises()

            expect(card.videoExists).toHaveBeenCalledTimes(1)
            expect(card.resetDownload).toHaveBeenCalledTimes(1)
        })

        test('does not reset the download when the video file still exists',async () => {
            const card = primeCard({ hasVideo:true, isDownloaded:true })
            card.videoExists = jest.fn().mockResolvedValue(true)
            card.resetDownload = jest.fn().mockResolvedValue(undefined)

            await (service as any).preloadDetails()
            await flushPromises()

            expect(card.videoExists).toHaveBeenCalledTimes(1)
            expect(card.resetDownload).not.toHaveBeenCalled()
        })

        test('does not check file existence for a non-downloaded / non-video route',async () => {
            const card = primeCard({ hasVideo:false, isDownloaded:false })
            card.videoExists = jest.fn().mockResolvedValue(false)
            card.resetDownload = jest.fn().mockResolvedValue(undefined)

            await (service as any).preloadDetails()
            await flushPromises()

            expect(card.videoExists).not.toHaveBeenCalled()
            expect(card.resetDownload).not.toHaveBeenCalled()
        })
    })

    describe('requestRouteDetails',()=>{

        let service:MockeableService
        const settle = async () => { for (let i=0;i<4;i++) await Promise.resolve() }

        beforeEach(()=>{
            // fresh singleton instance, isolated from the other describe blocks in this file
            new RouteListService().reset()
            Inject('UserSettings', { get: jest.fn().mockReturnValue({}), getValue: jest.fn().mockReturnValue({}), set: jest.fn() })
            service = prepareMock(null,{mockLoad:true})
        })

        afterEach(()=>{
            (service as any).reset()
            Inject('UserSettings', null)
            jest.restoreAllMocks()
        })

        test('is routed through getRouteDetails() and hands the details to the callback',async ()=>{
            const details = { points: [] } as any
            const spy = jest.spyOn(service,'getRouteDetails').mockResolvedValue(details)
            const onResult = jest.fn()

            service.requestRouteDetails('r1', onResult)
            await settle()

            expect(spy).toHaveBeenCalledWith('r1')
            expect(onResult).toHaveBeenCalledWith(details)
        })

        test('two requests for the same route make one getRouteDetails() call',async ()=>{
            const spy = jest.spyOn(service,'getRouteDetails').mockResolvedValue({} as any)
            const first = jest.fn()
            const second = jest.fn()

            service.requestRouteDetails('r1', first)
            service.requestRouteDetails('r1', second)
            await settle()

            expect(spy).toHaveBeenCalledTimes(1)
            expect(first).toHaveBeenCalled()
            expect(second).toHaveBeenCalled()
        })

        test('a request that is cancelled before its turn never loads',async ()=>{
            let release: (v:any)=>void = ()=>{}
            const spy = jest.spyOn(service,'getRouteDetails').mockImplementation(() => new Promise(r => { release = r }))

            // four loads fill the concurrency cap, the fifth waits
            ;['a','b','c','d'].forEach( id => service.requestRouteDetails(id, jest.fn()))
            const onResult = jest.fn()
            const cancel = service.requestRouteDetails('e', onResult)
            cancel()

            release({})
            await settle()

            expect(spy).not.toHaveBeenCalledWith('e')
            expect(onResult).not.toHaveBeenCalled()
        })

        test('an invalid request returns a no-op cancel',()=>{
            const spy = jest.spyOn(service,'getRouteDetails')

            const cancel = service.requestRouteDetails(undefined, jest.fn())

            expect(()=>cancel()).not.toThrow()
            expect(spy).not.toHaveBeenCalled()
        })

        test('getRouteDetails() itself is not limited by the queue',async ()=>{
            const spy = jest.spyOn(service,'getRouteDetails').mockResolvedValue({} as any)
            ;['a','b','c','d','e','f'].forEach( id => service.getRouteDetails(id))

            expect(spy).toHaveBeenCalledTimes(6)
        })
    })

})
