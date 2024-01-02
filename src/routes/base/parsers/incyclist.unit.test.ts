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

            test('file with informations',async ()=>{
                const file = './__tests__/data/rlv/FR_Col_de_Grimone_Part_1.xml'
  
                
                getBindings().loader = { open: load}
                const fileInfo:FileInfo = {type:'file', filename:file, name:'FR_Col_de_Grimone_Part_1.xml', ext:'xml',dir:'./__tests__/data/routes',url:undefined, delimiter:'/'}
                const {data,details} = await parser.import(fileInfo)
                    
                expect(data.title).toBe('Col de Grimone - 1 - Gorges des Gâts')
                expect(data.country).toBe('FR')
                expect(data.distance).toBeCloseTo(25600,-2)
                expect(data.elevation).toBeCloseTo(540,0)
                expect(data.hasVideo).toBe(true)
                expect(data.previewUrl).toBeUndefined()
                expect(data.videoFormat).toBe('mp4')
                //expect(data.videoUrl).toBe('file:///./__tests__/data/rlv/Triathlon_Woerrstadt_Loop.mp4')
                expect(data.isLocal).toBe(true)
                expect(data.id).toBe('e1bd3245-cb2b-483a-9f28-237713445540')
                expect(details.routeHash).toBe('c3e5d6059cb517b26bfe161b36d4d72f')
                expect(data.routeHash).toBe('c3e5d6059cb517b26bfe161b36d4d72f')

                expect(details.video?.mappings.length).toBeGreaterThan(0)

                expect( {data,details}).toMatchSnapshot()

            })
    

    
    
        })

        

    })

})