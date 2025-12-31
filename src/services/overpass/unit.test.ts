import { GET_WAYS_IN_AREA } from '../../maps/MapArea/consts';
import { buildQuery, getBounds } from '../../maps/MapArea/utils';
import {OverpassApi} from './overpass';
import fs from 'fs/promises'

describe ('OverpassClient Unit Test' ,() => {
    
    describe ( 'query', () => {

        let client:OverpassApi;
        let mock:any

        const setupMocks = (c:any,props:{response?:any,error?:any, noResponse?:boolean}) => {
            const {response,error,noResponse} = props
            if (response)
                c.post = jest.fn().mockResolvedValue(response)               
            else if (error) {                
                c.post = jest.fn().mockRejectedValue(error);
            }
            else if (noResponse) {
                c.timeouts = []
                c.post = jest.fn(async (query) => new Promise((done) => { 
                    const to = setTimeout(() => done('success'), 1000000)
                    c.timeouts.push(to)
                }));
            }
            else {
                c.post = jest.spyOn(c,'post')
            }

            mock = { post: c.post, timeouts: c.timeouts}
            return mock
        }

        beforeEach( ()=> {
            client = new OverpassApi();
        })

        afterEach( ()=>{
            if (mock) {
                const timeouts = mock.timeouts??[]
                timeouts.forEach( (t:NodeJS.Timeout)=>clearTimeout(t) )
                jest.resetAllMocks()
                jest.useRealTimers()
                client.reset()
            }
        })

        test ( 'positive case',async  () => {
            const response = {status:200,data:'success', statusText: 'OK', headers: {}, config: {}}
            const mocks = setupMocks(client,{response})
            const result = await client.query("myquery");
            expect(mocks.post).toHaveBeenCalledTimes(3)
            expect(result).toBe('success');
        } );

        test ( 'server sends error',async  () => {
            const error =  new Error('error-text')
            setupMocks(client,{error})
            await expect( async ()=> {await client.query("myquery")}).rejects.toThrow('All promises were rejected')
            
        } );
        test ( 'timeout',async  () => {

            jest.useFakeTimers()
            const mocks = setupMocks(client,{noResponse:true})

            let result:string|JSON|undefined = 'some dummy value'
            client.query("myquery",5000).then( res=> { result = res});
            
            jest.advanceTimersByTime(5000)
            jest.advanceTimersByTime(100)
            await jest.runAllTimersAsync()
            
            expect(mocks.post).toHaveBeenCalledTimes(3)
            expect(result).toBeUndefined()
            
        } );

        test.skip ( 'real api - explore query',async  () => {
            console.log('-------------------- TEST CASE SHOULD NOT BE PART OF A SUITE RUN')            
            expect(process.env.CI).toBeUndefined()  

            //const query = "[out:json];way[highway](26.68453889504663,-80.04377872640234,26.70250530495337,-80.02366907359766);(._;>;);out geom;"

            const query = "[out:json][timeout:25];way['addr:country'](around:20000,44.17260199999998,5.443198999999993);out tags;"
            const result = await client.query(query) as JSON       
            console.log(result)
        } );


        test.skip ( 'real api - generate test data for mocks',async  () => {



            console.log('-------------------- TEST CASE SHOULD NOT BE PART OF A SUITE RUN')            
            expect(process.env.CI).toBeUndefined()  


            // const query = "[out:json];way[highway](26.68453889504663,-80.04377872640234,26.70250530495337,-80.02366907359766);(._;>;);out geom;"
            // const fileName = './__tests__/data/overpass/default-3.json'

            const location = {
                lat: -34.305075359846555,
                lng: 18.82589606633218,
                id: "261772478"
            }
            
            const radius = 1435

            const boundary = getBounds(location.lat,location.lng,radius);
            const query = buildQuery(GET_WAYS_IN_AREA,boundary)
            const fileName = './__tests__/data/overpass/garden-issue1.json'

            const result = await client.query(query) as JSON       
            console.log(result)

            const str = JSON.stringify(result,null,2)
            fs.writeFile(fileName,str)            
            
        } );

        
        
        
    
    } )
    
})

