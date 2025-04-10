import { loadFile } from '../../../../__tests__/utils/loadFile'
import { FileInfo, getBindings } from '../../../api'
import { IncyclistXMLParser } from './incyclist'
import path from 'path'
import { IFileSystem } from '../../../api/fs'
import { RoutePoint } from '../types'

describe('IncyclistParser',()=>{
    let parser:IncyclistXMLParser
    let transform

    const load =  async (file) => {
        let data,error;

        try {
            data = await loadFile('utf-8',file.filename) as string            
            if (transform && typeof transform === 'function')
                data = transform(data)
            
        }
        catch(err) {
            error = err;
        } 
        return {data,error}

    }

    describe('Incyclist-XML',()=>{

        afterEach( ()=>{
            transform = undefined
        })


        describe('import',()=>{
            let fs;

            beforeEach( ()=>{
                parser = new IncyclistXMLParser()
                getBindings().path = path;
                fs = getBindings().fs = { existsFile:jest.fn().mockResolvedValue(true)} as unknown as IFileSystem
    
            })
    
            const run = async  (name,mocks?) => {
                const dir = './__tests__/data/rlv'
                const filename = `${dir}/${name}`
                getBindings().loader = { open: load}                
                fs.existsFile =  jest.fn().mockResolvedValue(mocks?.existsFile??false)
                const fileInfo:FileInfo = {type:'file', filename, name, ext:'xml',dir,url:undefined, delimiter:'/'}
                return await parser.import(fileInfo)
    
            }


            test('valid file',async ()=>{
                const {data,details} = await run('Triathlon_Woerrstadt_Loop.xml')
                    
                expect(data.localizedTitle).toEqual( {en:'Triathlon Wörrstadt'})
                expect(data.title).toBe('Triathlon Wörrstadt')
                expect(data.country).toBe('DE')
                expect(data.distance).toBeCloseTo(36700,-2)
                expect(data.elevation).toBeCloseTo(433,0)
                expect(data.hasVideo).toBe(true)
                expect(data.previewUrl).toBeUndefined()
                expect(data.videoFormat).toBe('mp4')
                expect(data.isLoop).toBe(true)

                //expect(data.videoUrl).toBe('file:///./__tests__/data/rlv/Triathlon_Woerrstadt_Loop.mp4')
                expect(data.isLocal).toBe(true)
                expect(data.id).toBe('e106d4b6b06e22d91fff110f29a1c0a0')

                expect( {data,details}).toMatchSnapshot()

            })


            test('GPX file missing',async ()=>{
                await expect( async ()=>{await run('missing_gpx.xml')}).rejects.toThrow('Could not open file: ./__tests__/data/rlv/__missing__.gpx')
            })
            test('GPX tag missing',async ()=>{
                await expect( async ()=>{await run('missing_gpx_tag.xml')}).rejects.toThrow('<gpx-file-path> missing in XML')
            })

            test('file with preview',async ()=>{
               
                const {data,details} = await run('FR_Source_Drome_Part_1.xml',{existsFile: true})
                    
                expect(data.title).toBe('Source Drôme 1 - Col de Prémol')
                expect(data.country).toBe('FR')
                expect(data.distance).toBeCloseTo(22100,-2)
                expect(data.elevation).toBeCloseTo(459,0)
                expect(data.hasVideo).toBe(true)
                expect(data.previewUrl).toBe(`file:///./__tests__/data/rlv/FR_Source_Drome_Part_1.png`)
                expect(data.videoFormat).toBe('mp4')
                expect(data.isLocal).toBe(true)
                expect(data.id).toBe('e60beaa7-1238-41c9-adbb-6be022de73ca')
                expect(details.routeHash).toBe('3d94fa436f9d90bb28c1a8ad08bb9bf8')
                expect(data.routeHash).toBe('3d94fa436f9d90bb28c1a8ad08bb9bf8')

                expect(details.video?.mappings.length).toBe(4182)

            })

            test('file with non-existing preview',async ()=>{
                const {data,details} = await run('FR_Source_Drome_Part_1.xml',{existsFile: false})
                    
                expect(data.title).toBe('Source Drôme 1 - Col de Prémol')
                expect(data.country).toBe('FR')
                expect(data.distance).toBeCloseTo(22100,-2)
                expect(data.elevation).toBeCloseTo(459,0)
                expect(data.hasVideo).toBe(true)
                expect(data.previewUrl).toBeUndefined()
                expect(data.videoFormat).toBe('mp4')
                expect(data.isLocal).toBe(true)
                expect(data.id).toBe('e60beaa7-1238-41c9-adbb-6be022de73ca')
                expect(details.routeHash).toBe('3d94fa436f9d90bb28c1a8ad08bb9bf8')
                expect(data.routeHash).toBe('3d94fa436f9d90bb28c1a8ad08bb9bf8')

                expect(details.video?.mappings.length).toBe(4182)

            })

            test('title in multiple languages',async ()=>{  
                transform = (data) => {
                    const regex = /<title>(.*?)<\/title>/
                    return data.replace(regex, "<title de='DE Title' en='EN Title'/>")
                }

                const {data,details} = await run('FR_Source_Drome_Part_1.xml',{existsFile: false})
                expect(data.title).toBe('DE Title')

            })

            test('bug: file delivering no points',async ()=>{
                const {data} = await run('DE_Rimberg-Kronenberg.xml')

                expect(data.points?.length).not.toBe(0)
            })

            test('cut tag',async ()=>{
                const {data} = await run('cut-test.xml')
                
                const points = data.points??[]

                expect(points[10].isCut).toBeTruthy()
                expect(data.distance).toBeCloseTo(101,0)

                // verify that slope is adjusted
                expect(points[9].elevation).toBeCloseTo(455,0)
                expect(points[10].elevation).toBeCloseTo(371,0)
                expect(Math.abs(points[9].slope??0)).toBeLessThan(10)
            })
    
        })

        describe('processElevationShift',()=>{

            let points:RoutePoint[]
            let p
            beforeEach( ()=>{                
                p = parser = new IncyclistXMLParser()                    
                points = []
                for (let i = 0; i < 10; i++) { 
                    const p = {
                        cnt: i,
                        routeDistance: i*100,
                        elevation: i*2,
                        slope: 2,
                        distance: 100,       
                        elevationGain: i*2,             
                    }
                    points.push(p as unknown as RoutePoint)
                }
            })

            test('with cut',()=>{
                points[6].isCut = true
                points.forEach( (pp,idx) => { 
                    if(idx>=6)  { 
                        pp.elevation+=100; 
                        pp.elevationGain =  pp.elevationGain??0+100
                    }
                })

                //og(points.map(p=>p.elevation).join(','))

                p.processElevationShift(3,points)

                const elevations = points.map(p=>p.elevation).join(',')
                expect(elevations).toBe('6,8,10,12,14,16,118,120,122,124')
                    
            })

            test('no cut',()=>{
                p.processElevationShift(3,points)

                const elevations = points.map(p=>p.elevation).join(',')
                expect(elevations).toBe('6,8,10,12,14,16,18,20,22,24')
                    
            })

            test('slope change',()=>{

                points = []
                let e = 0;
                let eg = 0;
                for (let i = 0; i < 10; i++) { 
                    const slope = i>5 ? 1 : 2;

                    const p = {
                        cnt: i,
                        routeDistance: i*100,
                        elevation: i==0 ? 0: slope+e,
                        slope,
                        distance: 100,       
                        elevationGain: i==0 ? 0: slope+eg,           
                    }
                    points.push(p as unknown as RoutePoint)
                    e = p.elevation
                    eg = p.elevationGain
                }

                p.processElevationShift(3,points)
                const elevations = points.map(p=>p.elevation).join(',')
                expect(elevations).toBe('6,8,10,11,12,13,14,15,16,17')

                const slopes = points.map(p=>p.slope).join(',')
                expect(slopes).toBe('2,2,2,1,1,1,1,1,1,1')
                    
            })



        })

        

    })

})