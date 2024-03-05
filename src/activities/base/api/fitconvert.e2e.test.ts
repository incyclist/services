import { IncyclistFitConvertApi } from "./fitconvert"
import { FitExportActivity } from "../model"
import fitData from '../../../../__tests__/data/activities/fittest.json'

const testData:FitExportActivity = fitData 

describe('FITConvert Api E2E',()=>{

    describe( 'convertToFit',()=>{

        test('positive',async ()=>{
            const api = new IncyclistFitConvertApi() 
            const data = {...testData}
    
            const res = await api.convertToFit(data)

            expect(Buffer.from(res).toString('hex')).toMatchSnapshot()
        })

        test('incorrect body',async ()=>{
            const api = new IncyclistFitConvertApi() 
            const data = {id:'123'} as unknown as FitExportActivity // invalid Payload            
    
            await expect( async ()=> { await api.convertToFit(data)}).rejects.toThrow()
        })
        
    })
})