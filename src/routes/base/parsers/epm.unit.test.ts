import { loadFile } from '../../../../__tests__/utils/loadFile'
import { FileInfo, getBindings } from '../../../api'
import { EPMParser } from './epm'

describe('IncyclistParser',()=>{
    let parser:EPMParser

    const load =  async (file) => {
        let data,error;

        const encoding = file.ext==='epp' ? 'binary' : 'utf-8'
        try {
            const str = await loadFile(encoding, file.filename)    as string
            data = encoding==='binary' ? Buffer.from(str,'ascii') : str
            
            
        }
        catch(err) {
            error = err;
        } 
        return {data,error}

    }

    describe('GPX',()=>{


        describe('import',()=>{
            beforeEach( ()=>{
                parser = new EPMParser()
                
            })
    
    
    
            test('valid file',async ()=>{
                const file = './__tests__/data/rlv/San_Leo.epm'
    
                
                getBindings().loader = { open: load}
                const fileInfo:FileInfo = {type:'file', filename:file, name:'San_Leo.epm', ext:'epm',dir:'./__tests__/data/rlv',url:undefined, delimiter:'/'}
                const {data,details} = await parser.import(fileInfo)
                    
                expect(data.localizedTitle).toEqual( {en:'San_Leo'})
                expect(data.title).toBe('San_Leo')
                expect(data.country).toBeUndefined()
                expect(data.distance).toBeCloseTo(12910,0)
                expect(data.elevation).toBeCloseTo(430,0)
                expect(data.hasVideo).toBe(true)
                expect(data.previewUrl).toBeUndefined()
                expect(data.videoFormat).toBe('avi')
                //expect(data.videoUrl).toBe('file:///./__tests__/data/rlv/Triathlon_Woerrstadt_Loop.mp4')
                expect(data.isLocal).toBe(true)
                expect(data.id).toBe('71586bbca0d7c9bdb92d1b49c60c06c6')

                expect( {data,details}).toMatchSnapshot()

            })

            //DE_Rad-am-Ring  9d5237af39903882f1481ad850c63ad4

            test('Rad am Ring',async ()=>{
                const file = './__tests__/data/rlv/DE_Rad-am-Ring.epm'
    
                
                getBindings().loader = { open: load}
                const fileInfo:FileInfo = {type:'file', filename:file, name:'DE_Rad-am-Ring.epm', ext:'epm',dir:'./__tests__/data/rlv',url:undefined, delimiter:'/'}
                const {data} = await parser.import(fileInfo)
                    
                expect(data.localizedTitle).toEqual( {en:'Rad-am-Ring'})

                expect(data.distance).toBeCloseTo(24300,-2)
                expect(data.elevation).toBeCloseTo(473,0)
                expect(data.hasVideo).toBe(true)

            })

            test('No Points',async ()=>{
                const file = './__tests__/data/rlv/Aigen.epm'
    
                
                getBindings().loader = { open: load}
                const fileInfo:FileInfo = {type:'file', filename:file, name:'Aigen.epm', ext:'epm',dir:'./__tests__/data/rlv',url:undefined, delimiter:'/'}
                const {data,details} = await parser.import(fileInfo)
                    
                expect(data.localizedTitle).toEqual( {en:'Aigen'})

                expect(data.distance).toBeCloseTo(40100,-2)
                expect(data.elevation).toBeCloseTo(323,0)
                expect(data.hasVideo).toBe(true)
                expect(data.hasGpx).toBe(false)
                expect(details.gpxDisabled).toBe(true)



            })
    
    
        })

        

    })

})