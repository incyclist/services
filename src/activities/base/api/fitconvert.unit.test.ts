import { IncyclistFitConvertApi } from "./fitconvert"
import { FitExportActivity } from "../model"
import fitData from '../../../../__tests__/data/activities/fittest.json'

const testData:FitExportActivity = fitData 

describe('FITConvert Api',()=>{

    describe( 'convertToFit',()=>{

        let a, api:IncyclistFitConvertApi
        const mock = {
            get:jest.fn(),
            post:jest.fn()
        }

        beforeEach( ()=>{
            a = api = new IncyclistFitConvertApi() 
            a.getApi = jest.fn().mockReturnValue(mock)
        })

        test('positive',async ()=>{
            const data = {...testData}
            const response = Buffer.from('0e201a08580100002e464954ceaa40000100000501028400010002028403048c04048600000f0403e8000030394048d6a24000010017070001020202840402841b0a0703048c050284fd0486000000ff0000496e6379636c697374000000000000644048d6a240000100cf0201100d030102000101020305080d1522375990e97962db0040000100140afd04860004850104850301020401020504860602840202840702842a0100004048d6a31fc2263803dada22965a0000018a0a5409c4009602004048d6a41fc2271c03dadb5b9b5a0000011f0c1009c400960240000100120afe0284050100060100090486080486020486fd04860704861902841a0284000000023a0000091e000019c94048d6a24048d6a4000019c900000001400001001306fe0284020486fd04860704860804860904860000004048d6a24048d6a4000019c9000019c90000091e400001002203fd0486010284000486004048d6a40001000019c949d9','hex')
    
            mock.post = jest.fn().mockResolvedValue({data:'http://localhost/test.fit',status:200})
            mock.get = jest.fn().mockResolvedValue( {data:response,status:200})
            const res = await api.convertToFit(data)

            expect(Buffer.from(res).toString('hex')).toMatchSnapshot()
        })

        test('conversion fails',async ()=>{
            const data = {...testData}
    
            mock.post = jest.fn().mockRejectedValue( new Error("XXX"))
            mock.get = jest.fn()
            await expect( async ()=> { await api.convertToFit(data)}).rejects.toThrow('convert failed: (phase convert), reason: XXX')
        })

        test('download fails',async ()=>{
            const data = {...testData}
    
            mock.post = jest.fn().mockResolvedValue({data:'http://localhost/test.fit',status:200})   
            mock.get = jest.fn().mockRejectedValue( new Error("XXX"))
            await expect( async ()=> { await api.convertToFit(data)}).rejects.toThrow('convert failed: (phase download), reason: XXX')
        })

        test('download fails',async ()=>{
        })

    })
})