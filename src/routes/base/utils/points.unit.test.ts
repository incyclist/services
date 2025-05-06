import rlv from '../../../../__tests__/data/rlv/pointfix.json'
import { RouteApiDetail } from '../api/types';
import { createFromJson } from "./route";
import { detectAnomalies, fixAnomalies} from './points'

describe.skip('Point Utils',()=>{

    describe('detectAnomalies',()=>{

        test('DK',()=>{
            const points = createFromJson(rlv as unknown as RouteApiDetail)?.points

            const res = detectAnomalies(points)
            console.log(res.map(d=>`${d.point.time}:${d.type},${d.idx},${Math.round(d.point.routeDistance)},${d.point.lat},${d.point.lng},${d.point.speed}`))
    
        })

    })


    describe('fixAnomalies',()=>{

        test('DK',()=>{
            try {
                console.log('starting')
                const points = createFromJson(rlv as unknown as RouteApiDetail)?.points
                const target = [...points]
                
                const {fixed,time,fixedRecords,error} = fixAnomalies(target,1000)
    
    
    
                const lock = fixedRecords.find( (r,idx) => idx>0 && r.idx===fixedRecords[idx-1].idx)
    
                console.log( fixed, time,  points.length,'->',target.length, lock??fixedRecords)
    
                if (error)
                    console.log(error)
    
                console.log(target.map((d,idx)=>`${idx}(${d.cnt}):${d.routeDistance},${d.lat},${d.lng},${d.distance}`))
    
            }
            catch(err) {
                console.log(err)
            }
        })

    })

})