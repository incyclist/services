import { loadFile } from '../../../../__tests__/utils/loadFile'
import { FileInfo, getBindings } from '../../../api'
import { parseXml } from '../../../utils'
import { GPXParser } from './gpx'


describe('GPXParser',()=>{
    let parser:GPXParser

    const load =  async (file) => {
        let data,error;

        try {
            data = await loadFile('utf-8',file.name) as string            
            
        }
        catch(err) {
            error = err;
        } 
        return {data,error}

    }

    describe('GPX',()=>{


        describe('import',()=>{
            beforeEach( ()=>{
                parser = new GPXParser()
                
            })
    
    
    
            test('valid file',async ()=>{
                const file = './__tests__/data/routes/Etzelbergrennen.gpx'
    
                
                getBindings().loader = { open: load}
                
                
    
                const fileInfo:FileInfo = {type:'file', name:file, ext:'gpx',dir:'./__tests__/data/routes',url:undefined, delimiter:'/'}
                const {data,details} = await parser.import(fileInfo)
                expect(details.title).toBe('X-BIONIC® Etzel Bergzeitfahren')
    
                expect(data.title).toBe('X-BIONIC® Etzel Bergzeitfahren')
                expect(data.country).toBe(undefined)
                expect(data.distance).toBeCloseTo(7832,0)
                expect(data.elevation).toBeCloseTo(681,0)
                expect(data.hasVideo).toBe(false)
                expect(data.previewUrl).toBeUndefined()
                expect(data.isLocal).toBe(true)
                expect(data.id).toBeDefined()

                expect( {data,details}).toMatchSnapshot()

            },100000)
    
    
            test('invalid file',async ()=>{
                const file = './__tests__/data/rlv/AU_Cape_Naturaliste.xml'
                const xml = await loadFile('utf-8',file) as string
                const fileInfo:FileInfo = {type:'file', name:file, ext:'xml',dir:'./__tests__/data/rlv',url:undefined, delimiter:'/'}
                const xmlJson = await parseXml(xml)
    
                await expect( async ()=> {await parser.import(fileInfo,xmlJson)}).rejects.toThrow('cannot parse <Track>')
    
                
           })

           test('missing elevations',async ()=>{
            const file = './__tests__/data/routes/ele-missing.gpx'

            
            getBindings().loader = { open: load}
            
            

            const fileInfo:FileInfo = {type:'file', name:file, ext:'gpx',dir:'./__tests__/data/routes',url:undefined, delimiter:'/'}
            const {data} = await parser.import(fileInfo)

            const missing = data.points?.find( p=>p.elevation===undefined)
            expect(missing).toBeUndefined()


        },100000)
       
        })

        describe('supportsContent',()=> {
            beforeEach( ()=>{
                parser = new GPXParser()
                
            })

            test('valid gpx',()=>{
                //parser.supportsContent()
            })
          
        })

        

    })

})