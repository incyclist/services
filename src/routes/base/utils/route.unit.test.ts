import path from "path";
import { FileInfo, getBindings } from "../../../api";
import { IFileSystem } from "../../../api/fs";
import { loadFile } from "../../../../__tests__/utils/loadFile";
import { Route } from "../model/route";
import { createFromJson, getElevationGainAt, getNextPosition, getTotalElevation, validateRoute,getRouteHash,updateSlopes } from "./route";
import fs from 'fs'
import { KWTParser } from "../parsers/kwt";
import { parseXml } from "../../../utils";

describe( 'Route Utils',()=>{

    let route
    beforeEach( async ()=>{

        
        getBindings().path = path;
        getBindings().fs = fs as unknown as IFileSystem
        const parser = new KWTParser

        const file = './__tests__/data/rlv/DE_Arnbach.xml'
        const xml = await loadFile('utf-8',file) as string
        const xmlJson = await parseXml(xml)
        const fileInfo:FileInfo = {type:'file',filename:file, name:'DE_Arnbach.xml', ext:'xml',dir:'./__tests__/data/rlv',url:undefined, delimiter:'/'}
        const {data,details} = await parser.import(fileInfo, xmlJson)
                
        route = new Route( data,details)


    })

    describe( 'getTotalElevation',()=>{

        test('not validated',()=>{
            route.details.points.forEach(p=>{
                delete p.elevationGain
                delete p.slope
            })
            const elevation = getTotalElevation(route.details)
            expect(elevation).toBeCloseTo(202,0)

        })
        
        test('validated',()=>{
            validateRoute(route)
            const elevation = getTotalElevation(route.details)
            expect(elevation).toBeCloseTo(202,0)

        })

    })

    describe( 'updateSlopes',()=>{
        test('no cut',()=>{
            const slopesBefore = route.details.points.map( p=> p.slope)
            route.details.points.forEach(p=>{delete p.slope})

            updateSlopes(route.details.points)
            const slopesAfter = route.details.points.map( p=> p.slope)
            expect(slopesAfter ).toEqual(slopesBefore)
        })
    })

    describe( 'getElevationGainAt',()=>{

        test('at start',()=>{
            route.details.points.forEach(p=>{
                delete p.elevationGain
                delete p.slope
            })
            const elevation = getElevationGainAt(route,0)
            expect(elevation).toBeCloseTo(0,0)
        })
        
        test('at 1km',()=>{
            route.details.points.forEach(p=>{
                delete p.elevationGain
                delete p.slope
            })
            const elevation = getElevationGainAt(route,1000)
            expect(elevation).toBeCloseTo(23.4,1)
        })

        test('at 11.7km',()=>{
            route.details.points.forEach(p=>{
                delete p.elevationGain
                delete p.slope
            })
            const elevation = getElevationGainAt(route,11720)
            expect(elevation).toBeCloseTo(202.1,1)
        })
        test('at 12.7km - 1km in 2nd lap',()=>{
            route.details.points.forEach(p=>{
                delete p.elevationGain
                delete p.slope
            })
            const elevation = getElevationGainAt(route,12720)
            expect(elevation).toBeCloseTo(225.5,1)
        })
        test('at 24.4km - 1km in 3rd lap',()=>{
            route.details.points.forEach(p=>{
                delete p.elevationGain
                delete p.slope
            })
            const elevation = getElevationGainAt(route,24440)
            expect(elevation).toBeCloseTo(427.6,1)
        })

    })


    describe( 'getNextPosition',()=>{


        test('1',()=>{
            const routeDistance = 130
            const prev = route.points[8]

            const res = getNextPosition(route,{routeDistance,prev} )

            expect(res?.slope).toBeCloseTo(2.1,1)
            expect(res?.elevation).toBeCloseTo(213.6,1)
        })

        test('next lap',()=>{
            const routeDistance = 11800
            const prev = route.points[837]

            const res = getNextPosition(route,{routeDistance,prev} )
            expect(res.lap).toBe(2)
            expect(res.cnt).toBe(4)
            expect(res.routeDistance).toBe(78)
        })

    })


    describe( 'createFromJson',()=>{

        test('valid',async ()=>{
            const file = './__tests__/data/rlv/ES_Teide.json'
            const jsonStr = await loadFile('utf-8',file) as string
            const json = JSON.parse(jsonStr)

            const route = createFromJson(json)
            expect(route.description.title).toBe('Zusammenfügen1')
            expect(route.description.distance).toBe(67632)
            expect(route.description.hasGpx).toBeTruthy()
   
        })
        test('no gpx',async ()=>{
            const file = './__tests__/data/rlv/ES_Teide.json'
            const jsonStr = await loadFile('utf-8',file) as string
            const json = JSON.parse(jsonStr)
            delete json.points
            delete json.decoded

            const route = createFromJson(json)
            expect(route.description.title).toBe('Zusammenfügen1')
            expect(route.description.distance).toBe(67632)
            expect(route.description.hasGpx).toBeFalsy()
   
        })

    })

    describe('getRouteHash',()=>{
      
        test('video',()=>{

            const hash = getRouteHash(route.details)
            expect(hash).toBe('4287767686b6327b8284fab983c6621b')
        })

        test('no points, but EPP',()=>{
            
            delete route.details.points
            route.details.epp = {programData:[ {elevation:0, distance:0, x:0},{elevation:1, distance:100, x:0},{elevation:2, distance:2000, x:0}] }
            const hash = getRouteHash(route.details)
            expect(hash).toBe('41c04620052c18d760611e3a39f1380f')
            
        })
    })


})