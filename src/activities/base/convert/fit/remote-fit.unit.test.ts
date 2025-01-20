import testData from '../../../.././../__tests__/data/activities/vancouver.json'
import { ActivityDetails } from '../../model'
import {RemoteFitConverter} from './index'

describe('FITConverter',()=> {

    let c,converter:RemoteFitConverter;
    const fit = Buffer.from('0e201a08580100002e464954ceaa40000100000501028400010002028403048c04048600000f0403e8000030394048d6a24000010017070001020202840402841b0a0703048c050284fd0486000000ff0000496e6379636c697374000000000000644048d6a240000100cf0201100d030102000101020305080d1522375990e97962db0040000100140afd04860004850104850301020401020504860602840202840702842a0100004048d6a31fc2263803dada22965a0000018a0a5409c4009602004048d6a41fc2271c03dadb5b9b5a0000011f0c1009c400960240000100120afe0284050100060100090486080486020486fd04860704861902841a0284000000023a0000091e000019c94048d6a24048d6a4000019c900000001400001001306fe0284020486fd04860704860804860904860000004048d6a24048d6a4000019c9000019c90000091e400001002203fd0486010284000486004048d6a40001000019c949d9','hex')


    beforeEach( ()=>{
        c = converter = new RemoteFitConverter()
        c.getUserSettings = jest.fn().mockReturnValue( {
            get: jest.fn( (key,defValue)=>defValue)
        })
        
    })


    test('valid activity',async ()=>{        
        const activity = testData as unknown as ActivityDetails
        c.getApi().convertToFit = jest.fn().mockResolvedValue(fit)

        
        const result = await converter.convert(activity);
        expect(result).toEqual(fit)
        expect(c.getApi().convertToFit).toHaveBeenCalledWith( 
            expect.objectContaining({status:'created'} ))
    })

    test('conversion fails',async ()=>{        
        const activity = testData as unknown as ActivityDetails
        c.getApi().convertToFit = jest.fn().mockRejectedValue( new Error('XX'))

        
        await expect( async ()=> {await converter.convert(activity)}).rejects.toThrow('XX');
    })


    test('non integer cadence',async ()=>{        

        const activity = testData as unknown as ActivityDetails
        const logEntry = testData.logs[0]
        logEntry.cadence = 90.1
        logEntry.power = 123.456
        logEntry.heartrate = 145.678
        testData.logs = [logEntry]
        
        c.getApi().convertToFit = jest.fn().mockResolvedValue(fit)

        
        await converter.convert(activity);        

        // define const to make it easier to read the assertion
        const OC = (x)=>expect.objectContaining(x)

        expect(c.getApi().convertToFit).toHaveBeenCalledWith( 
            OC({logs: [ OC({cadence:90, heartrate:146, power:123}) ]} ))
    })


})