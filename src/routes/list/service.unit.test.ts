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
            const withDefault = service.searchRepo().routes.map(r=>r.id)

            service.setSortOrder('suggested')
            const withExplicit = service.searchRepo().routes.map(r=>r.id)

            expect(withDefault).toEqual(withExplicit)
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
        let userSettings

        beforeAll ( async ()=>{
            service = prepareMock(null,{mockLoad:true})
        })

        beforeEach( ()=>{
            originalParser = RouteParser.parse
            userSettings = useUserSettings()
            userSettings.get = jest.fn().mockReturnValue({})
            userSettings.set = jest.fn()

        })


        afterEach( ()=>{
            RouteParser.parse = originalParser
            service.reset()
            userSettings?.reset()
            

        })

        test('failed import, followed by successfull import',async ()=>{
            const data: RouteInfo = {  id:'test', title:'test'}
            const details: RouteApiDetail= {  id:'test', title:'test'}
            const result: ParseResult<RouteApiDetail> = { data,details}

            
            RouteParser.parse = jest.fn()
                .mockRejectedValueOnce( new Error('Some Error'))
                .mockResolvedValueOnce( result)

            service.cardObserver = new Observer()
            service.cardObserver.emit = jest.fn()

            await service.import( {type:'file', name:'test1.xml',filename:'/test1',dir:'/',ext:'xml', delimiter:'/'})
            let card2 = service.myRoutes.getCards()[2]
            expect(card2.getDisplayProperties()).toMatchObject({name:'test1.xml',error:expect.objectContaining({message:'Some Error'}),visible:true})

            await service.import( {type:'file', name:'test2.xml',filename:'/test2',dir:'/',ext:'xml', delimiter:'/'})
            card2 = service.myRoutes.getCards()[2]
            const card3 = service.myRoutes.getCards()[3]
            expect(card2.getDisplayProperties()).toMatchObject({name:'test1.xml',error:expect.objectContaining({message:'Some Error'}),visible:true})

            expect(card3.getDisplayProperties()).toMatchObject(expect.objectContaining({id:'test',title:'test',tsImported:expect.anything()}))

        })

        test('failed import, check that search still works',async ()=>{
            const data: RouteInfo = {  id:'test', title:'test'}
            const details: RouteApiDetail= {  id:'test', title:'test'}
            const result: ParseResult<RouteApiDetail> = { data,details}


            RouteParser.parse = jest.fn()
            .mockResolvedValueOnce( result)
            .mockRejectedValueOnce( new Error('Some Error'))

            service.cardObserver = new Observer()
            service.cardObserver.emit = jest.fn()

            // onse successfull import to populate the list
            await service.import( {type:'file', name:'test1.xml',filename:'/test1',dir:'/',ext:'xml', delimiter:'/'})

            // one failed import (2nd response to RouteParser.parse is configured to fail (see above) )
            await service.import( {type:'file', name:'test1.xml',filename:'/test1',dir:'/',ext:'xml', delimiter:'/'})

            const res = service.search()
            expect(res?.routes.length).toBeGreaterThan(0)



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

})