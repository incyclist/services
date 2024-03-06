import path from "path";
import { FileInfo, getBindings } from "../../../api";
import { IFileSystem } from "../../../api/fs";
import { loadFile } from "../../../../__tests__/utils/loadFile";
import { Route } from "../model/route";
import { getElevationGainAt, getTotalElevation, validateRoute } from "./route";
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
            validateRoute(route.details)
            const elevation = getTotalElevation(route.details)
            expect(elevation).toBeCloseTo(202,0)

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

})