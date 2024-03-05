
import { ActivityDetails } from '../../model';
import {TcxConverter} from './tcx';

import testData from '../../../.././../__tests__/data/activities/vancouver.json'

import clone from '../../../../utils/clone';

describe('TCXConverter',()=> {



    test('valid acitvity',async ()=>{        
        const activity = testData as unknown as ActivityDetails
        const converter = new TcxConverter()
        
        const result = await converter.convert(activity);
        expect(result).toMatchSnapshot();        
    })

    test.skip('no coordinates',async ()=>{
        const activity = clone(testData) as unknown as ActivityDetails
        activity.logs.forEach( p=> { delete p.lat; delete p.lng})

        const converter = new TcxConverter()
        const result = await converter.convert(activity);
        expect(result).toMatchSnapshot();                
    })



})