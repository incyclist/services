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
import { RoutesPageService } from "../page/service";

import type { ParseResult } from "../types";
import { RouteServerValidationError } from "../servers/errors";
import * as probeModule from "../servers/probe";


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

    describe('getFilterRouteSources',()=>{

        let service
        let appsServiceMock
        let userSettingsMock

        const APPS = [
            {key:'strava',name:'Strava'},
            {key:'komoot',name:'Komoot'},
            {key:'intervals',name:'Intervals.icu'},
        ]

        beforeEach(()=>{
            service = prepareMock(null,{mockLoad:true})
            appsServiceMock = { getAvailableServices: jest.fn().mockReturnValue([]), getApps: jest.fn().mockReturnValue(APPS) }
            userSettingsMock = { getValue: jest.fn().mockReturnValue(null) }
            Inject('AppsService', appsServiceMock)
            Inject('UserSettings', userSettingsMock)
        })

        afterEach(()=>{
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            service.reset()
            Inject('AppsService', null)
            Inject('UserSettings', null)
        })

        const stubRoutes = (routes) => {
            service['getRoutesForFilterOptions'] = jest.fn().mockReturnValue(routes)
        }

        test('no routes: always includes Local and Incyclist',()=>{
            stubRoutes([])

            const sources = service.getFilterRouteSources()

            expect(sources).toEqual(['Local','Incyclist'])
        })

        test('route source of an app: is shown with the display name of the app',()=>{
            stubRoutes([{source:'Strava'}])

            const sources = service.getFilterRouteSources()

            expect(sources).toEqual(['Local','Incyclist','Strava'])
        })

        test('app that is not connected (not offering route download): is still listed if routes exist',()=>{
            appsServiceMock.getAvailableServices.mockReturnValue([])
            stubRoutes([{source:'komoot'}])

            expect(service.getFilterRouteSources()).toEqual(['Local','Incyclist','Komoot'])
        })

        test('app with a display name that differs from its key: display name is used',()=>{
            stubRoutes([{source:'intervals'}])

            expect(service.getFilterRouteSources()).toEqual(['Local','Incyclist','Intervals.icu'])
        })

        test('route server that is configured: is listed pascal-cased',()=>{
            userSettingsMock.getValue.mockReturnValue({'Alpine Videos':'https://alpine.example.com'})
            stubRoutes([{source:'AlpineVideos'}])

            expect(service.getFilterRouteSources()).toEqual(['Local','Incyclist','AlpineVideos'])
        })

        test('source of a server that is not configured (removed, or only known on another device): is listed',()=>{
            userSettingsMock.getValue.mockReturnValue(null)
            stubRoutes([{source:'unknown'}])

            expect(service.getFilterRouteSources()).toEqual(['Local','Incyclist','Unknown'])
        })

        test('route has no source or an empty source: is ignored',()=>{
            stubRoutes([{source:undefined},{source:''},{source:null}])

            expect(service.getFilterRouteSources()).toEqual(['Local','Incyclist'])
        })

        test('Local and Incyclist are never added twice',()=>{
            stubRoutes([{source:'local'},{source:'INCYCLIST'}])

            expect(service.getFilterRouteSources()).toEqual(['Local','Incyclist'])
        })

        test('spellings that share one pascalCase: listed once',()=>{
            stubRoutes([{source:'alpine videos'},{source:'Alpine-Videos'},{source:'ALPINE_VIDEOS'}])

            expect(service.getFilterRouteSources()).toEqual(['Local','Incyclist','AlpineVideos'])
        })

        test('multiple routes sharing a source: source is listed once',()=>{
            stubRoutes([{source:'Strava'},{source:'Strava'}])

            expect(service.getFilterRouteSources()).toEqual(['Local','Incyclist','Strava'])
        })

        test('everything after Local and Incyclist is sorted alphabetically, ignoring case',()=>{
            stubRoutes([{source:'zeta'},{source:'komoot'},{source:'Beta'},{source:'alpha'}])

            expect(service.getFilterRouteSources()).toEqual(['Local','Incyclist','Alpha','Beta','Komoot','Zeta'])
        })

        test('no apps: sources of routes are still offered',()=>{
            Inject('AppsService', { getAvailableServices: jest.fn().mockReturnValue([]), getApps: jest.fn().mockReturnValue([]) })
            stubRoutes([{source:'something'}])

            expect(service.getFilterRouteSources()).toEqual(['Local','Incyclist','Something'])
        })

        test('passes the filters through to getRoutesForFilterOptions, excluding the routeSource dimension',()=>{
            stubRoutes([])

            service.getFilterRouteSources({contentType:'Video'})

            expect(service['getRoutesForFilterOptions']).toHaveBeenCalledWith({contentType:'Video'},'routeSource')
        })

    })

    describe('getFilterRouteSourceLabels',()=>{
        let service
        let userSettingsMock
        beforeEach(()=>{
            service = prepareMock(null,{mockLoad:true})
            userSettingsMock = { getValue: jest.fn().mockReturnValue(null) }
            Inject('UserSettings', userSettingsMock)
            Inject('AppsService', { getAvailableServices: jest.fn().mockReturnValue([]), getApps: jest.fn().mockReturnValue([{key:'intervals',name:'Intervals.icu'}]) })
        })
        afterEach(()=>{
            service.reset()
            Inject('AppsService', null)
            Inject('UserSettings', null)
        })
        const stubRoutes = (routes) => { service['getRoutesForFilterOptions'] = jest.fn().mockReturnValue(routes) }

        test('configured server: shown with the name as typed, the value stays pascal-cased',()=>{
            userSettingsMock.getValue.mockReturnValue({'Ebeling Hoppe':'https://x.example.com'})
            stubRoutes([{source:'EbelingHoppe', apiServer:'Ebeling Hoppe'}])

            expect(service.getFilterRouteSources()).toEqual(['Local','Incyclist','EbelingHoppe'])
            expect(service.getFilterRouteSourceLabels()).toEqual({Local:'Local',Incyclist:'Incyclist',EbelingHoppe:'Ebeling Hoppe'})
        })

        test('configured name wins over the apiServer of the routes (server was renamed by re-adding)',()=>{
            userSettingsMock.getValue.mockReturnValue({'ebeling-hoppe':'https://x.example.com'})
            stubRoutes([{source:'EbelingHoppe', apiServer:'Ebeling Hoppe'}])

            expect(service.getFilterRouteSourceLabels().EbelingHoppe).toBe('ebeling-hoppe')
        })

        test('server that is not configured: apiServer of the routes is used',()=>{
            stubRoutes([{source:'EbelingHoppe', apiServer:'Ebeling Hoppe'}])

            expect(service.getFilterRouteSourceLabels().EbelingHoppe).toBe('Ebeling Hoppe')
        })

        test('neither configured nor apiServer: falls back to the pascal-cased source',()=>{
            stubRoutes([{source:'unknown'}])

            expect(service.getFilterRouteSourceLabels().Unknown).toBe('Unknown')
        })

        test('apps keep their display name',()=>{
            stubRoutes([{source:'intervals'}])

            expect(service.getFilterRouteSourceLabels()['Intervals.icu']).toBe('Intervals.icu')
        })

        test('getFilterOptions offers the labels',()=>{
            stubRoutes([{source:'EbelingHoppe', apiServer:'Ebeling Hoppe'}])
            service.getFilterCountries = jest.fn().mockReturnValue([])
            service.getFilterContentTypes = jest.fn().mockReturnValue([])
            service.getFilterRouteTypes = jest.fn().mockReturnValue([])

            const options = service.getFilterOptions()

            expect(options.routeSources).toContain('EbelingHoppe')
            expect(options.routeSourceLabels.EbelingHoppe).toBe('Ebeling Hoppe')
        })
    })

    describe('getRouteSourceLabel',()=>{
        let service
        let userSettingsMock
        beforeEach(()=>{
            service = prepareMock(null,{mockLoad:true})
            userSettingsMock = { getValue: jest.fn().mockReturnValue(null) }
            Inject('UserSettings', userSettingsMock)
            Inject('AppsService', { getAvailableServices: jest.fn().mockReturnValue([]), getApps: jest.fn().mockReturnValue([{key:'intervals',name:'Intervals.icu'},{key:'strava',name:'Strava'}]) })
        })
        afterEach(()=>{
            service.reset()
            Inject('AppsService', null)
            Inject('UserSettings', null)
        })
        const setRoutes = (list:Array<{source:string,apiServer?:string}>) => { service.routes = list.map( description=>({description}) ) }

        test('server route that is not configured: the name as typed',()=>{
            expect(service.getRouteSourceLabel({source:'EbelingHoppe',apiServer:'Ebeling Hoppe'})).toBe('Ebeling Hoppe')
        })
        test('app routes: display name of the app',()=>{
            expect(service.getRouteSourceLabel({source:'intervals'})).toBe('Intervals.icu')
            expect(service.getRouteSourceLabel({source:'Strava'})).toBe('Strava')
        })
        test('no source: undefined',()=>{
            expect(service.getRouteSourceLabel({})).toBeUndefined()
            expect(service.getRouteSourceLabel(undefined)).toBeUndefined()
        })
        test('source without app or server: the filter option value',()=>{
            expect(service.getRouteSourceLabel({source:'unknown'})).toBe('Unknown')
        })
        test('configured server with the same key wins over the apiServer of the route, as in the filter options',()=>{
            userSettingsMock.getValue.mockReturnValue({'Abc D':'https://x.example.com'})
            setRoutes([{source:'AbCd',apiServer:'Ab Cd'}])
            service['getRoutesForFilterOptions'] = jest.fn().mockReturnValue([{source:'AbCd',apiServer:'Ab Cd'}])

            expect(service.getRouteSourceLabel({source:'AbCd',apiServer:'Ab Cd'})).toBe('Abc D')
            expect(service.getFilterRouteSourceLabels().AbCd).toBe('Abc D')
        })
        test('removed server with differently spelled names: most frequent wins, ties alphabetically',()=>{
            setRoutes([{source:'AbCd',apiServer:'Ab Cd'},{source:'AbCd',apiServer:'Abc D'},{source:'AbCd',apiServer:'Abc D'}])
            expect(service.getRouteSourceLabel({source:'AbCd',apiServer:'Ab Cd'})).toBe('Abc D')

            setRoutes([{source:'AbCd',apiServer:'Ab Cd'},{source:'AbCd',apiServer:'Abc D'}])
            expect(service.getRouteSourceLabel({source:'AbCd',apiServer:'Abc D'})).toBe('Ab Cd')
            service['getRoutesForFilterOptions'] = jest.fn().mockReturnValue([{source:'AbCd',apiServer:'Abc D'}])
            expect(service.getFilterRouteSourceLabels().AbCd).toBe('Ab Cd')
        })
    })

    describe('getFilterRouteSources order',()=>{
        test('sorted by label, Local and Incyclist first',()=>{
            const service = prepareMock(null,{mockLoad:true})
            Inject('UserSettings', { getValue: jest.fn().mockReturnValue(null) })
            Inject('AppsService', { getAvailableServices: jest.fn().mockReturnValue([]), getApps: jest.fn().mockReturnValue([]) })
            service['getRoutesForFilterOptions'] = jest.fn().mockReturnValue([
                {source:'Zeta'},{source:'AlpineVideos',apiServer:'zz Alpine'},{source:'beta',apiServer:'Beta'}
            ])
            expect(service.getFilterRouteSources()).toEqual(['Local','Incyclist','Beta','Zeta','AlpineVideos'])
            Inject('AppsService', null)
            Inject('UserSettings', null)
            service.reset()
        })
    })

    describe('getFilters with saved app source',()=>{
        let service
        let saved
        beforeEach(()=>{
            service = prepareMock(null,{mockLoad:true})
            saved = {}
            Inject('UserSettings', { get: jest.fn(()=>saved) })
            Inject('AppsService', { getApps: jest.fn().mockReturnValue([{key:'intervals',name:'Intervals.icu'}]) })
            Inject('UnitConverter', { getUnitConversionShortcuts: jest.fn().mockReturnValue([jest.fn(),jest.fn()]) })
            service.filters = undefined
        })
        afterEach(()=>{
            service.reset()
            Inject('UnitConverter', null)
            Inject('AppsService', null)
            Inject('UserSettings', null)
        })

        test('value saved by an earlier version is mapped to the app display name',()=>{
            saved = {routeSource:'Intervals'}
            expect(service.getFilters().routeSource).toBe('Intervals.icu')
        })
        test('joined values: apps are mapped, others stay',()=>{
            saved = {routeSource:'Local|Intervals|EbelingHoppe'}
            expect(service.getFilters().routeSource).toBe('Local|Intervals.icu|EbelingHoppe')
        })
        test('current and unknown values stay as they are',()=>{
            saved = {routeSource:'Intervals.icu|Unknown'}
            expect(service.getFilters().routeSource).toBe('Intervals.icu|Unknown')
        })
    })

    describe('applySourceFilter with app display names',()=>{
        let service
        beforeEach(()=>{
            service = prepareMock(null,{mockLoad:true})
            Inject('AppsService', { getApps: jest.fn().mockReturnValue([{key:'intervals',name:'Intervals.icu'}]) })
        })
        afterEach(()=>{
            service.reset()
            Inject('AppsService', null)
        })

        test('the display name of an app selects the routes carrying the app key',()=>{
            const routes = [{source:'intervals'},{source:'strava'},{source:undefined,isLocal:true}]
            expect(service.applySourceFilter({routeSource:'Intervals.icu'},routes)).toEqual([{source:'intervals'}])
        })

        test('a server name selects the routes of that server',()=>{
            const routes = [{source:'Alpine Videos'},{source:'strava'}]
            expect(service.applySourceFilter({routeSource:'AlpineVideos'},routes)).toEqual([{source:'Alpine Videos'}])
        })
    })

    describe('route servers',()=>{
        let service
        let settings: Record<string,string>
        let userSettingsMock
        let factoryMock
        let statusMock

        const OK_URL = 'https://alpine.example.com/api'

        const addRoute = (id:string, props:Record<string,unknown>={})=> {
            const route = new Route({id,title:id,hasVideo:true,apiServer:'Alpine Videos',...props} as unknown as RouteInfo)
            service.routes.push(route)
            return route
        }

        beforeEach(()=>{
            service = prepareMock(null,{mockLoad:true})
            service.routes = []
            settings = {}
            userSettingsMock = {
                getValue: jest.fn((key:string,def)=> key==='routes.servers' ? (Object.keys(settings).length ? {...settings}:def) : def),
                set: jest.fn((key:string,value)=> {
                    const name = key.replace('routes.servers.','')
                    if (value===null) delete settings[name]; else settings[name]=value
                })
            }
            factoryMock = { invalidate: jest.fn(), create: jest.fn() }
            statusMock = { remove: jest.fn() }
            Inject('UserSettings', userSettingsMock)
            Inject('AppsService', { getApps: jest.fn().mockReturnValue([{key:'strava',name:'Strava'}]), getAvailableServices: jest.fn().mockReturnValue([]) })
            Inject('IncyclistRoutesApi', factoryMock)
            Inject('RouteServerStatus', statusMock)
        })

        afterEach(()=>{
            service.reset()
            Inject('UserSettings', null)
            Inject('AppsService', null)
            Inject('IncyclistRoutesApi', null)
            Inject('RouteServerStatus', null)
        })

        describe('addExternalApiProvider',()=>{
            test('the log carries the origin and how the server was picked',()=>{
                const logEvent = jest.spyOn(service,'logEvent')

                service.addExternalApiProvider('Alpine Videos', 'alpine.example.com', {origin:'import',via:'known'})

                expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({message:'route server added', key:'Alpine Videos', origin:'import', via:'known'}))
            })

            test('valid name and url: stored normalised, api cache invalidated',()=>{
                const res = service.addExternalApiProvider('  Alpine   Videos ', 'alpine.example.com')

                expect(res).toEqual({name:'Alpine Videos', url:'https://alpine.example.com/'})
                expect(userSettingsMock.set).toHaveBeenCalledWith('routes.servers.Alpine Videos','https://alpine.example.com/')
                expect(factoryMock.invalidate).toHaveBeenCalledWith('Alpine Videos')
            })

            test('S1: invalid name throws and leaves the settings unchanged',()=>{
                expect(()=>service.addExternalApiProvider('a"b',OK_URL)).toThrow(RouteServerValidationError)
                expect(userSettingsMock.set).not.toHaveBeenCalled()
                expect(factoryMock.invalidate).not.toHaveBeenCalled()
            })

            test.each(['a.b','constructor','strava','Local'])('name %s is refused',(name)=>{
                expect(()=>service.addExternalApiProvider(name,OK_URL)).toThrow(RouteServerValidationError)
                expect(userSettingsMock.set).not.toHaveBeenCalled()
            })

            test('invalid url throws and leaves the settings unchanged',()=>{
                try {
                    service.addExternalApiProvider('Alpine','http://evil.example.com')
                    throw new Error('did not throw')
                }
                catch(err) {
                    expect(err).toBeInstanceOf(RouteServerValidationError)
                    expect(err).toMatchObject({field:'url',code:'http-internet'})
                }
                expect(userSettingsMock.set).not.toHaveBeenCalled()
            })

            test('home-network http is accepted (the platform flag is not part of the service rules)',()=>{
                const res = service.addExternalApiProvider('Nas','http://nas:8080')
                expect(res.url).toBe('http://nas:8080/')
            })

            test('name that already exists (same pascalCase): refused',()=>{
                service.addExternalApiProvider('Alpine Videos',OK_URL)
                expect(()=>service.addExternalApiProvider('alpine-videos','https://other.example.com')).toThrow(RouteServerValidationError)
            })

            test('url that already exists: refused',()=>{
                service.addExternalApiProvider('Alpine Videos',OK_URL)
                expect(()=>service.addExternalApiProvider('Other','HTTPS://Alpine.Example.com/api/')).toThrow(RouteServerValidationError)
            })

            test('url of the built-in server: refused',()=>{
                expect(()=>service.addExternalApiProvider('Mine','https://dlws.incyclist.com/api/v1/routes')).toThrow(RouteServerValidationError)
            })
        })

        describe('getExternalApiProviders',()=>{
            test('none configured: null',()=>{
                expect(service.getExternalApiProviders()).toBeNull()
            })
            test('configured: map of name to url',()=>{
                service.addExternalApiProvider('Alpine Videos',OK_URL)
                expect(Array.from(service.getExternalApiProviders().entries())).toEqual([['Alpine Videos',OK_URL]])
            })
        })

        describe('deleteExternalApiProvider',()=>{
            test('removes the setting, drops the cached api and the status',()=>{
                service.addExternalApiProvider('Alpine Videos',OK_URL)
                factoryMock.invalidate.mockClear()

                service.deleteExternalApiProvider('Alpine Videos')

                expect(settings).toEqual({})
                expect(factoryMock.invalidate).toHaveBeenCalledWith('Alpine Videos')
                expect(statusMock.remove).toHaveBeenCalledWith('Alpine Videos')
            })

            test('re-adding the same name with a new url uses the new url',()=>{
                service.addExternalApiProvider('Alpine Videos',OK_URL)
                service.deleteExternalApiProvider('Alpine Videos')
                service.addExternalApiProvider('Alpine Videos','https://new.example.com/api')

                expect(settings['Alpine Videos']).toBe('https://new.example.com/api')
                expect(factoryMock.invalidate).toHaveBeenCalledTimes(3)
            })
        })

        describe('validateExternalApiProviderName/Url',()=>{
            test('reserved names are computed from the apps at check time',()=>{
                expect(service.validateExternalApiProviderName('strava')).toMatchObject({valid:false,code:'reserved-source'})
                Inject('AppsService', { getApps: jest.fn().mockReturnValue([{key:'strava',name:'Strava'},{key:'newapp',name:'New App'}]) })
                expect(service.validateExternalApiProviderName('new app')).toMatchObject({valid:false,code:'reserved-source'})
            })

            test('the platform flag decides about home-network http',()=>{
                expect(service.validateExternalApiProviderUrl('http://nas')).toMatchObject({valid:false,code:'http-not-supported'})
                expect(service.validateExternalApiProviderUrl('http://nas',{allowsLocalHttp:true}).valid).toBe(true)
            })

            test('ROUTE_API override is treated as built-in server',()=>{
                userSettingsMock.getValue.mockImplementation((key:string,def)=> key==='ROUTE_API' ? 'https://my.dev/routes' : def)
                expect(service.validateExternalApiProviderUrl('https://my.dev/routes/')).toMatchObject({valid:false,code:'built-in'})
            })
        })

        describe('probeExternalApiProvider',()=>{
            test('returns the result of the check',async ()=>{
                const probe = jest.spyOn(probeModule,'checkRouteServer').mockResolvedValue({ok:true,routeCount:3,url:OK_URL})

                const res = await service.probeExternalApiProvider(OK_URL,'http://x')

                expect(res).toEqual({ok:true,routeCount:3,url:OK_URL})
                expect(probe).toHaveBeenCalledWith(OK_URL,'http://x')
                probe.mockRestore()
            })
        })

        describe('route count and delete',()=>{
            test('counts the routes of one server, ignoring deleted routes and other servers',()=>{
                addRoute('a1'); addRoute('a2'); addRoute('a3',{isDeleted:true}); addRoute('b1',{apiServer:'Other'}); addRoute('l1',{apiServer:undefined})

                expect(service.getExternalApiProviderRouteCount('Alpine Videos')).toBe(2)
                expect(service.getExternalApiProviderRouteCount('alpine-videos')).toBe(2)
                expect(service.getExternalApiProviderRouteCount('Nope')).toBe(0)
            })

            test('download info: count and total size of downloaded videos',async ()=>{
                addRoute('a1',{isDownloaded:true,videoUrl:'video:///videos/a1.mp4'})
                addRoute('a2',{isDownloaded:true,videoUrl:'file:///videos/a2.mp4'})
                addRoute('a3')
                const stat = jest.fn(async (path:string)=>({size: path.endsWith('a1.mp4') ? 1000:500}))
                getBindings().fs = {...getBindings().fs, stat} as unknown as IFileSystem

                const info = await service.getExternalApiProviderDownloadInfo('Alpine Videos')

                expect(info).toEqual({routeCount:3,downloadedCount:2,downloadedBytes:1500})
                expect(stat).toHaveBeenCalledWith('/videos/a1.mp4')
                expect(stat).toHaveBeenCalledWith('/videos/a2.mp4')
            })

            test('download info: size can not be determined',async ()=>{
                addRoute('a1',{isDownloaded:true,videoUrl:'video:///videos/a1.mp4'})
                getBindings().fs = {...getBindings().fs, stat:undefined} as unknown as IFileSystem
                getBindings().fileAccess = undefined

                const info = await service.getExternalApiProviderDownloadInfo('Alpine Videos')

                expect(info).toEqual({routeCount:1,downloadedCount:1,downloadedBytes:undefined})
            })

            test('download info: nothing downloaded',async ()=>{
                addRoute('a1')
                expect(await service.getExternalApiProviderDownloadInfo('Alpine Videos')).toEqual({routeCount:1,downloadedCount:0,downloadedBytes:0})
            })

            test('deletes routes of the server (and their downloads) through their cards, nothing else',async ()=>{
                const a1 = addRoute('a1',{isDownloaded:true,videoUrl:'video:///videos/a1.mp4'})
                const a2 = addRoute('a2')
                addRoute('b1',{apiServer:'Other'})

                const calls: Array<string> = []
                const cardFor = (id:string)=> ({
                    deleteDownload: jest.fn(async ()=>{ calls.push(`download:${id}`) }),
                    delete: jest.fn(()=>({ wait: async ()=>{ calls.push(`delete:${id}`) } }))
                })
                const cards = { a1:cardFor('a1'), a2:cardFor('a2') }
                service.findCard = jest.fn((id:string)=>({card:cards[id]}))
                service.emitLists = jest.fn()

                const res = await service.deleteExternalApiProviderRoutes('Alpine Videos')

                expect(res).toEqual({deleted:2,failed:0})
                expect(calls.indexOf('download:a1')).toBeLessThan(calls.indexOf('delete:a1'))
                expect(calls).toEqual(expect.arrayContaining(['download:a1','delete:a1','delete:a2']))
                expect(calls).toHaveLength(3)
                expect(cards.a1.delete).toHaveBeenCalledWith({enforced:true,source:'user'})
                expect(service.findCard).not.toHaveBeenCalledWith('b1')
                expect([a1,a2]).toHaveLength(2)
            })

            test('a route that can not be deleted is counted, the others are still deleted',async ()=>{
                addRoute('a1'); addRoute('a2')
                service.findCard = jest.fn((id:string)=>({card:{
                    deleteDownload: jest.fn(),
                    delete: jest.fn(()=>({ wait: async ()=>{ if (id==='a1') throw new Error('disk') } }))
                }}))
                service.emitLists = jest.fn()

                const res = await service.deleteExternalApiProviderRoutes('Alpine Videos')

                expect(res).toEqual({deleted:1,failed:1})
            })

            test('percent-encoded and Windows video urls are converted to the path the binding expects',async ()=>{
                addRoute('a1',{isDownloaded:true,videoUrl:'file:///C:/My%20Videos/a1.mp4'})
                addRoute('a2',{isDownloaded:true,videoUrl:'file:///data/My%20Videos/a2.mp4'})
                const stat = jest.fn(async ()=>({size:1}))
                getBindings().fs = {...getBindings().fs, stat} as unknown as IFileSystem

                await service.getExternalApiProviderDownloadInfo('Alpine Videos')

                expect(stat).toHaveBeenCalledWith('C:/My Videos/a1.mp4')
                expect(stat).toHaveBeenCalledWith('/data/My Videos/a2.mp4')
            })

            test('route without a card: removed from the repository and the downloaded file is deleted',async ()=>{
                addRoute('a1',{isDownloaded:true,videoUrl:'video:///videos/a1.mp4'})
                const unlink = jest.fn().mockResolvedValue(undefined)
                getBindings().fs = {...getBindings().fs, unlink} as unknown as IFileSystem
                service.findCard = jest.fn().mockReturnValue(undefined)
                service.db = { delete: jest.fn().mockResolvedValue(undefined) }
                service.emitLists = jest.fn()

                const res = await service.deleteExternalApiProviderRoutes('Alpine Videos')

                expect(res).toEqual({deleted:1,failed:0})
                expect(unlink).toHaveBeenCalledWith('/videos/a1.mp4')
                expect(service.db.delete).toHaveBeenCalled()
                expect(service.getExternalApiProviderRouteCount('Alpine Videos')).toBe(0)
            })
        })

        describe('loadExternalApiProvider',()=>{
            test('loads the server through the loader and adds its routes to the list',async ()=>{
                const observer = new Observer()
                service.api = { loadServer: jest.fn().mockReturnValue(observer) }
                service.addFromApi = jest.fn()
                service.update = jest.fn()

                const promise = service.loadExternalApiProvider('Alpine Videos')
                const route = new Route({id:'a1',title:'a1'} as unknown as RouteInfo)
                observer.emit('route.added',route)
                observer.emit('route.updated',route)
                observer.emit('done')
                await promise

                expect(service.api.loadServer).toHaveBeenCalledWith('Alpine Videos')
                expect(service.addFromApi).toHaveBeenCalledWith(route)
                expect(service.update).toHaveBeenCalledWith(route)
            })
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

            test('a route without a video is not looked up next to a video and takes no screenshot', async () => {
                const d = descr({ videoUrl:undefined })
                const check = jest.spyOn(service as any, 'checkExistingPreviewFiles')

                const result = await (service as any).doCreatePreview(d)

                expect(result).toBeUndefined()
                expect(check).not.toHaveBeenCalled()
                expect(getBindings().video.screenshot).not.toHaveBeenCalled()
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

    describe('preloadDetails - recover lost download state', () => {
        // A finished download whose state was never persisted is recognisable from the description
        // (original video URL set, isDownloaded missing). Only the first routes of the list get their
        // details preloaded, so the recovery has to reach routes beyond that window as well.

        let service:MockeableService

        beforeEach(() => {
            new RouteListService().reset()
            service = prepareMock(null,{mockLoad:true})
            ;(service as any).sortOrder = 'name'
        })

        afterEach(() => {
            (service as any).reset()
            ;(new RoutesDbLoader() as any).reset()
        })

        // retitled to sort last, so it is beyond the preload cap (PRELOAD_DESKTOP/PRELOAD_MOBILE)
        const primeLastCard = (overrides:Partial<RouteInfo>):RouteCard => {
            const routes = service['routes']
            const route = routes[routes.length-1]
            Object.assign(route.description, { title:'zzz-recover-test-route' }, overrides)
            return service.getCard(route.description.id)
        }

        const lostDownload:Partial<RouteInfo> = {
            hasVideo:true, isLocal:false, isDownloaded:undefined,
            videoUrl:'https://videos.incyclist.com/x.mp4', originalVideoUrl:'https://videos.incyclist.com/x.mp4'
        }

        test('recovers a route outside the preload window, loading its details first',async () => {
            const card = primeLastCard(lostDownload)
            const details = { id:card.getId(), video:{ url:'video:///videos/x.mp4' } } as any
            const getDetails = jest.spyOn((service as any).db,'getDetails').mockImplementation( async id => id===card.getId() ? details : undefined )
            card.recoverDownloadState = jest.fn().mockResolvedValue(true)

            await (service as any).preloadDetails()

            expect(getDetails).toHaveBeenCalledWith(card.getId())
            expect(card.getRouteData()).toBe(details)
            expect(card.recoverDownloadState).toHaveBeenCalledTimes(1)
        })

        test('leaves a route alone that never completed a download',async () => {
            const card = primeLastCard({ ...lostDownload, originalVideoUrl:undefined })
            const getDetails = jest.spyOn((service as any).db,'getDetails').mockResolvedValue(undefined)
            card.recoverDownloadState = jest.fn().mockResolvedValue(true)

            await (service as any).preloadDetails()

            expect(getDetails).not.toHaveBeenCalledWith(card.getId())
            expect(card.recoverDownloadState).not.toHaveBeenCalled()
        })

        test('leaves a route alone that is marked as downloaded already',async () => {
            const card = primeLastCard({ ...lostDownload, isDownloaded:true })
            jest.spyOn((service as any).db,'getDetails').mockResolvedValue(undefined)
            card.recoverDownloadState = jest.fn().mockResolvedValue(true)
            card.videoExists = jest.fn().mockResolvedValue(true)

            await (service as any).preloadDetails()

            expect(card.recoverDownloadState).not.toHaveBeenCalled()
        })

        test('a failing recovery does not stop the other routes',async () => {
            const card = primeLastCard(lostDownload)
            jest.spyOn((service as any).db,'getDetails').mockResolvedValue({ id:card.getId(), video:{ url:'video:///videos/x.mp4' } } as any)
            card.recoverDownloadState = jest.fn().mockRejectedValue(new Error('boom'))

            await expect((service as any).preloadDetails()).resolves.toBeUndefined()
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

            // a row asking on its own is a list fetch: it must not repeat a descriptor load that just failed
            expect(spy).toHaveBeenCalledWith('r1', false, 'list')
            expect(onResult).toHaveBeenCalledWith(details)
        })

        test('a shared route without details and without country does not load its descriptor to verify the country',()=>{
            const loadDescriptor = jest.fn()
            service.inject('RouteSharingClient', { loadDescriptor })
            const route = { details: undefined, description: { linkShared: true }, updateCountryFromPoints: jest.fn() }

            ;(service as any).verifyRouteCountry(route)

            expect(loadDescriptor).not.toHaveBeenCalled()
            expect(route.updateCountryFromPoints).not.toHaveBeenCalled()
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


    describe('linkShared routes',()=>{
        let service:MockeableService
        const sharing = { loadDescriptor: jest.fn() }
        const shared = () => new Route({ id:'sh1', routeHash:'sh1', title:'Shared', isLocal:true, hasVideo:true, linkShared:true, distance:1000 })

        beforeEach(()=>{
            new RouteListService().reset()
            service = prepareMock(null,{mockLoad:true})
            Inject('RouteSharingClient', sharing)
            ;(service as any).db.getDetails = jest.fn().mockResolvedValue(undefined)
            ;(service as any).db.save = jest.fn().mockResolvedValue(undefined)
            ;(service as any).db.delete = jest.fn().mockResolvedValue(undefined)
            ;(service as any).api = { loadDetails: jest.fn() }
        })
        afterEach(()=>{
            Inject('RouteSharingClient', null)
            ;(service as any).reset()
            ;(new RoutesDbLoader() as any).reset()
            jest.clearAllMocks()
        })

        test('details are requested from the computer, never from an API',async ()=>{
            service.addRoute(shared())
            sharing.loadDescriptor.mockImplementation(async (route:Route) => { route.details = { id:'sh1', title:'Shared', points:[] } as RouteApiDetail; return route })

            await service.getRouteDetails('sh1')

            expect(sharing.loadDescriptor).toHaveBeenCalledWith(expect.objectContaining({description:expect.objectContaining({id:'sh1'})}),'details')
            expect((service as any).api.loadDetails).not.toHaveBeenCalled()
        })

        test('a computer that can not be reached leaves the details absent without an error',async ()=>{
            service.addRoute(shared())
            sharing.loadDescriptor.mockRejectedValue(new Error('unreachable'))

            const res = await service.getRouteDetails('sh1')

            expect(res).toMatchObject({ totalDistance: expect.anything() })
            expect(service.getRoute('sh1')?.details).toBeUndefined()
            expect((service as any).api.loadDetails).not.toHaveBeenCalled()
        })

        test('persisted details are used without asking the computer',async ()=>{
            service.addRoute(shared())
            ;(service as any).db.getDetails = jest.fn().mockResolvedValue({ id:'sh1', title:'Shared', points:[], video:{} })
            await service.getRouteDetails('sh1')
            expect(sharing.loadDescriptor).not.toHaveBeenCalled()
        })

        test('addRoutes adds several routes with one update event and refreshes known ones in place',()=>{
            service.addRoute(shared())
            const emit = jest.spyOn(service,'emitLists')
            const updated = new Route({ ...shared().description, title:'Renamed' })
            const other = new Route({ id:'sh2', title:'Other', isLocal:true, hasVideo:true, linkShared:true })

            service.addRoutes([updated, other])

            expect(emit).toHaveBeenCalledTimes(1)
            expect(service.getRoute('sh1')?.description.title).toBe('Renamed')
            expect(service.getRoute('sh2')).toBeDefined()
        })

        describe('a shared route never replaces a local route',()=>{
            const local = (extra:Record<string,unknown>={}) => new Route({ id:'sh1', routeHash:'sh1', title:'Mine', isLocal:true, hasVideo:true, videoUrl:'file:///mine.mp4', distance:5, ...extra } as any)

            test('visible local route with the same id is left untouched',()=>{
                service.addRoute(local())
                service.addRoutes([shared()],'system')

                const route = service.getRoute('sh1')!
                expect(route.description.linkShared).toBeUndefined()
                expect(route.description.title).toBe('Mine')
                expect(route.description.videoUrl).toBe('file:///mine.mp4')
                expect((service as any).routes.filter( (r:Route)=>r.description.id==='sh1')).toHaveLength(1)
            })

            test('tombstoned local route with the same id is left untouched and not duplicated',()=>{
                service.addRoute(local({isDeleted:true}))
                service.addRoutes([shared()],'system')

                const all = (service as any).routes.filter( (r:Route)=>r.description.id==='sh1')
                expect(all).toHaveLength(1)
                expect(all[0].description.linkShared).toBeUndefined()
                expect(all[0].description.isDeleted).toBe(true)
            })

            test('removeSharedRoute refuses a route that is not a shared placeholder',async ()=>{
                service.addRoute(local())
                const res = await service.removeSharedRoute(shared())

                expect(res).toBe(false)
                expect((service as any).db.delete).not.toHaveBeenCalled()
                expect(service.getRoute('sh1')).toBeDefined()
            })

            test('a local route that arrives after the placeholder replaces it completely',()=>{
                const placeholder = shared()
                placeholder.details = { id:'sh1', title:'Shared', points:[], video:{url:'http://desktop/v/x'} } as any
                service.addRoute(placeholder)

                service.addRoute(local(),'system')

                const route = service.getRoute('sh1')!
                expect(route.description.linkShared).toBeUndefined()
                expect(route.description.title).toBe('Mine')
                expect(route.details).toBeUndefined()
                expect((service as any).routes.filter( (r:Route)=>r.description.id==='sh1')).toHaveLength(1)
            })
        })

        test('a route added through addRoutes shows up on an open Routes page without reopening it',()=>{
            const page = new RoutesPageService()
            Inject('RouteList', service)
            Inject('VideoResolver', { isAvailable: jest.fn().mockReturnValue(true), getLinkSnapshot: jest.fn().mockReturnValue(new Map()), getRouteAvailability: jest.fn().mockReturnValue({ canStart:true, availability:'local' }), getThumbnailLink: jest.fn() })
            Inject('UserSettings', { getValue: jest.fn((_k:string, d:unknown) => d), get: jest.fn((_k:string, d:unknown) => d) })
            Inject('VideoAvailability', { on: jest.fn(), off: jest.fn() })
            Inject('FolderAccess', { on: jest.fn(), off: jest.fn() })
            Inject('LocalLinkClient', { on: jest.fn(), off: jest.fn() })
            Inject('SharingClient', { on: jest.fn(), off: jest.fn() })
            Inject('RouteDownload', { on: jest.fn(), off: jest.fn(), getActiveDownloads: jest.fn().mockReturnValue([]) })
            try {
                const p = page as any
                p.subscribeAllActiveDownloads = jest.fn()
                jest.spyOn(service,'isStillLoading').mockReturnValue(false)
                p.serviceState = service.search()
                p.startEventListener()
                const before = page.getPageDisplayProps().routes.map( r=>r.id )
                expect(before).not.toContain('sh1')

                service.addRoutes([shared()], 'system')

                expect(page.getPageDisplayProps().routes.map( r=>r.id )).toContain('sh1')
                p.stopEventListener()
            }
            finally {
                page.reset()
                for (const key of ['RouteList','VideoResolver','UserSettings','VideoAvailability','FolderAccess','LocalLinkClient','SharingClient','RouteDownload'])
                    Inject(key, null)
            }
        })

        test('addRoutes without a new route sends no update event',()=>{
            service.addRoute(shared())
            const emit = jest.spyOn(service,'emitLists')
            service.addRoutes([new Route({ ...shared().description, title:'Renamed' })])
            expect(emit).not.toHaveBeenCalled()
        })

        test('saveRoute persists through the db',async ()=>{
            const route = shared()
            await service.saveRoute(route, true)
            expect((service as any).db.save).toHaveBeenCalledWith(route, true)
        })

        describe('updateLinkSources',()=>{
            const own = () => new Route({ id:'o1', routeHash:'h1', title:'Own', isLocal:false, hasVideo:true, requiresDownload:true, distance:5000, country:'DE' })

            beforeEach(()=>{
                ;(service as any).db.saveDescriptions = jest.fn()
            })

            test('changes only the marker, in memory and in one description write, without touching details',()=>{
                const route = own()
                const before = JSON.parse(JSON.stringify(route.description))
                service.addRoute(route)

                const changed = service.updateLinkSources([{ id:'o1', linkSources:['A','B'] }])

                expect(changed).toBe(1)
                expect(service.getRoute('o1')?.description).toEqual({ ...before, linkSources:['A','B'] })
                expect((service as any).db.saveDescriptions).toHaveBeenCalledTimes(1)
                expect((service as any).db.saveDescriptions).toHaveBeenCalledWith([route])
                expect((service as any).db.save).not.toHaveBeenCalled()
                expect((service as any).db.getDetails).not.toHaveBeenCalled()
                expect((service as any).api.loadDetails).not.toHaveBeenCalled()
            })

            test('a route whose marker did not change is not saved',()=>{
                service.addRoute(new Route({ ...own().description, linkSources:['A'] }))
                expect(service.updateLinkSources([{ id:'o1', linkSources:['A'] }])).toBe(0)
                expect((service as any).db.saveDescriptions).not.toHaveBeenCalled()
            })

            test('an empty marker removes the field',()=>{
                service.addRoute(new Route({ ...own().description, linkSources:['A'] }))
                expect(service.updateLinkSources([{ id:'o1', linkSources:[] }])).toBe(1)
                expect(service.getRoute('o1')?.description).not.toHaveProperty('linkSources')
            })

            test('an unknown route is ignored and a failure is not thrown',()=>{
                expect(service.updateLinkSources([{ id:'nope', linkSources:['A'] }])).toBe(0)
                service.addRoute(own())
                ;(service as any).db.saveDescriptions = jest.fn(()=>{ throw new Error('boom') })
                expect(service.updateLinkSources([{ id:'o1', linkSources:['A'] }])).toBe(0)
            })
        })

        test('removeSharedRoute removes route, card and persisted record',async ()=>{
            const route = shared()
            service.addRoute(route)
            expect(service.findCard('sh1')).toBeDefined()

            await service.removeSharedRoute(route)

            expect(service.getRoute('sh1')).toBeUndefined()
            expect(service.findCard('sh1')?.card).toBeUndefined()
            expect((service as any).db.delete).toHaveBeenCalled()
        })
    })

})
