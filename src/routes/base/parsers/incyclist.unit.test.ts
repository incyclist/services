import { loadFile } from '../../../../__tests__/utils/loadFile'
import { FileInfo, getBindings } from '../../../api'
import { IncyclistXMLParser } from './incyclist'

describe('IncyclistParser',()=>{
    let parser:IncyclistXMLParser

    const load =  async (file) => {
        let data,error;

        try {
            data = await loadFile('utf-8',file.filename) as string            
            
        }
        catch(err) {
            error = err;
        } 
        return {data,error}

    }

    describe('GPX',()=>{


        describe('import',()=>{
            beforeEach( ()=>{
                parser = new IncyclistXMLParser()
                
            })
    
    
    
            test('valid file',async ()=>{
                const file = './__tests__/data/rlv/Triathlon_Woerrstadt_Loop.xml'
  
                
                getBindings().loader = { open: load}
                const fileInfo:FileInfo = {type:'file', filename:file, name:'Triathlon_Woerrstadt_Loop.xml', ext:'xml',dir:'./__tests__/data/routes',url:undefined, delimiter:'/'}
                const {data,details} = await parser.import(fileInfo)
                    
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

            test('file with preview',async ()=>{
                const name = 'FR_Source_Drome_Part_1.xml'
                const dir = './__tests__/data/rlv'
                const filename = `${dir}/${name}`
                
                getBindings().loader = { open: load}
                const fileInfo:FileInfo = {type:'file', filename, name, ext:'xml',dir,url:undefined, delimiter:'/'}
                const {data,details} = await parser.import(fileInfo)
                    
                expect(data.title).toBe('Source Drôme 1 - Col de Prémol')
                expect(data.country).toBe('FR')
                expect(data.distance).toBeCloseTo(22100,-2)
                expect(data.elevation).toBeCloseTo(459,0)
                expect(data.hasVideo).toBe(true)
                expect(data.previewUrl).toBe(`file:///${dir}/FR_Source_Drome_Part_1.png`)
                expect(data.videoFormat).toBe('mp4')
                expect(data.isLocal).toBe(true)
                expect(data.id).toBe('e60beaa7-1238-41c9-adbb-6be022de73ca')
                expect(details.routeHash).toBe('3d94fa436f9d90bb28c1a8ad08bb9bf8')
                expect(data.routeHash).toBe('3d94fa436f9d90bb28c1a8ad08bb9bf8')

                expect(details.video?.mappings.length).toBe(4182)

            })



    
    
        })

        

    })

})