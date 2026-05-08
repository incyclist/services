import { loadFile } from '../../../../__tests__/utils/loadFile'
import { FileInfo, getBindings } from '../../../api'
import { BikeLabParser } from './bikelab'


describe('BikeLabParser',()=>{
    let parser:BikeLabParser

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



    describe('import',()=>{
        beforeEach( ()=>{
            parser = new BikeLabParser()
            
        })



        test('valid file',async ()=>{
            const file = './__tests__/data/rlv/Randa.xml'

            
            getBindings().loader = { open: load}
            const fileInfo:FileInfo = {type:'file', filename:file, name:'Triathlon_Woerrstadt_Loop.xml', ext:'gpx',dir:'./__tests__/data/routes',url:undefined, delimiter:'/'}
            const {data,details} = await parser.import(fileInfo)
                
            expect(data.localizedTitle).toEqual( {en:'Randa'})
            expect(data.title).toBe('Randa')
            expect(data.country).toBe(undefined)
            expect(data.distance).toBeCloseTo(4800,-2)
            expect(data.elevation).toBeCloseTo(242,0)
            expect(data.hasVideo).toBe(true)
            expect(data.previewUrl).toBeUndefined()
            expect(data.videoFormat).toBe('mp4')
            //expect(data.videoUrl).toBe('file:///./__tests__/data/rlv/Triathlon_Woerrstadt_Loop.mp4')
            expect(data.isLocal).toBe(true)
            expect(data.id).toBe('d3fe29ae2af56ea604f5ad28dfb29702')

            expect( {data,details}).toMatchSnapshot()

        },100000)



    })

    

  
})