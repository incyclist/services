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
import { ParseResult, RouteInfo } from "../base/types";
import { Observer } from "../../base/types/observer";

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
                list.add( card)
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
    
    if (database) database = db;
    
    
    service.loadRoutesFromApi = jest.fn().mockResolvedValue([])
    

    const filesystem = fs as unknown as IFileSystem;
    filesystem.checkDir = jest.fn()

    getBindings().path = path;
    getBindings().fs = filesystem
    getBindings().video = {
        isScreenshotSuported:jest.fn().mockReturnValue(true),
        isConvertSuported:jest.fn().mockReturnValue(true),
        screenshot:jest.fn().mockResolvedValue('screenshot'),
        convert:jest.fn()

    }
    const access:JsonAccess = {
        read:jest.fn(),
        write:jest.fn().mockResolvedValue(true),
        delete:jest.fn().mockResolvedValue(true)
    }
    getBindings().db = {
        create:jest.fn().mockResolvedValue(access),
        get:jest.fn().mockResolvedValue(access),
        release:jest.fn().mockResolvedValue(true)            
        
    }

    getBindings().appInfo = {
        getAppDir:jest.fn().mockReturnValue(os.tmpdir())
    } as unknown as IAppInfo
    return service
}

describe('RouteListService',()=>{



    describe('preload',()=>{

        let db
        let service:MockeableService



        beforeEach(()=>{ 
            service = prepareMock(db,{mockLoad:false})
        })

        afterEach( ()=>{
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (service as any).reset()
            db?.reset()
        })

        test('1',async ()=>{

            const sort = (a,b) => a.id<b.id ? -1 : 1
            const observer = service.preload()
            await observer.wait()

            const {routes} = service.search()
            expect(routes.length).toBe(34)

            // remove observer before we check the result against expectation
            routes.forEach( r => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const d = r as any
                delete d.observer
            })
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

    })


    describe( 'search',()=>{

        let service;

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

        test('title filter should be case insensitive',()=>{
            const {routes} = service.search({title:'sydney'})
            expect(routes.length).toBe(1)
            expect(routes.map(r=>r.title)).toEqual( ['Sydney Opera House and Botanic Garden' ])    
        })

    })

    describe('import',()=>{
        let service;
        let originalParser

        beforeAll ( async ()=>{
            service = prepareMock(null,{mockLoad:true})
        })

        beforeEach( ()=>{
            originalParser = RouteParser.parse

        })


        afterEach( ()=>{
            RouteParser.parse = originalParser
            service.reset()
            

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

    })

})