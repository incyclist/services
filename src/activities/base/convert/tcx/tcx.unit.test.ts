
import { ActivityDetails } from '../../model';
import {TcxConverter} from './tcx';

import testData from '../../../.././../__tests__/data/activities/vancouver.json'
import workoutData from '../../../.././../__tests__/data/activities/with_workout.json'
import clone from '../../../../utils/clone';
import { parseXml } from '../../../../utils/xml';


const getLap = async (result:string) => {
    const json = await parseXml(result)
    json.expectScheme('TrainingCenterDatabase')
    const lap = json.json.Activities.Activity.Lap
    return lap
}

describe('TCXConverter',()=> {

    let c

    test('valid acitvity',async ()=>{        
        const activity = testData as unknown as ActivityDetails
        const converter = new TcxConverter()
        
        const result = await converter.convert(activity);
        expect(result).toMatchSnapshot();        

        const json = await parseXml(result)
        json.expectScheme('TrainingCenterDatabase')
       
    })

    test('errors during converions',async ()=>{        
        const activity = testData as unknown as ActivityDetails
        const converter = new TcxConverter()
        c = converter
        c.creatTrackPoints = jest.fn( ()=>{ throw new Error('XXX')})
        
        
        await expect( async ()=> { await converter.convert(activity)}).rejects.toThrow('XXX')
        
    })

    test('no stats',async ()=>{
        const activity = {...testData} as unknown as ActivityDetails
        delete activity.stats

        const converter = new TcxConverter()
        const result = await converter.convert(activity);
        const lap = await getLap(result)
        
        
        expect(lap.AverageHeartRateBpm).toBeUndefined
        expect(lap.MaximumHeartRateBpm).toBeUndefined
        expect(lap.MaximumSpeed).toBeUndefined
        expect(lap.Cadence).toBeUndefined
    })

    test('no coordinates',async ()=>{
        const activity = clone(testData) as unknown as ActivityDetails
        activity.logs.forEach( p=> { delete p.lat; delete p.lng})

        const converter = new TcxConverter()
        const result = await converter.convert(activity);
        const lap = await getLap(result)
        const points = lap.Track.Trackpoint

        // no positions in TCX
        expect(points.find(p=>p.Position!==undefined)).toBeUndefined()
    })

    test('legacy format',async ()=>{
        // simulate a legacy formatted activity (no type, longitude listed in 'lon' field)
        const activity = clone({...testData,type:null}) as unknown as ActivityDetails
        activity.logs.forEach( p=> { p.lon = p.lng; delete p.lng})
        

        const converter = new TcxConverter()
        const result = await converter.convert(activity);
        const lap = await getLap(result)
        const points = lap.Track.Trackpoint

        // all records have a position
        expect(points.find(p=>p.Position===undefined)).toBeUndefined()
    })

    test('activity with workout, should add workout steps as laps',async ()=>{
        const activity = workoutData as unknown as ActivityDetails
        const converter = new TcxConverter()
        
        const result = await converter.convert(activity);
        expect(result).toMatchSnapshot();        
    })


})