import { GET_WAYS_IN_AREA } from '../../maps/MapArea/consts';
import { buildQuery, getBounds } from '../../maps/MapArea/utils';
import {OverpassApi} from './overpass';
import fs from 'fs/promises'

describe ('OverpassClient Unit Test' ,() => {
    
    describe ( 'query', () => {

        let client:OverpassApi;
        let timeoutsToClear:NodeJS.Timeout[]

        // The self-hosted request goes through getRestClient() (IncyclistRestApiClient),
        // never through post() - post() is only ever used for the public mirrors.
        const mockSelfHosted = (c:any,props:{response?:any,error?:any, noResponse?:boolean}) => {
            const {response,error,noResponse} = props
            let postMock:jest.Mock
            if (response)
                postMock = jest.fn().mockResolvedValue(response)
            else if (error)
                postMock = jest.fn().mockRejectedValue(error)
            else if (noResponse) {
                postMock = jest.fn(() => new Promise((done) => {
                    const to = setTimeout(() => done('success'), 1000000)
                    timeoutsToClear.push(to)
                }))
            }
            c.getRestClient = jest.fn(() => ({ post: postMock }))
            return postMock
        }

        const mockMirrors = (c:any,props:{response?:any,error?:any, noResponse?:boolean}) => {
            const {response,error,noResponse} = props
            if (response)
                c.post = jest.fn().mockResolvedValue(response)
            else if (error)
                c.post = jest.fn().mockRejectedValue(error)
            else if (noResponse) {
                c.post = jest.fn(() => new Promise((done) => {
                    const to = setTimeout(() => done('success'), 1000000)
                    timeoutsToClear.push(to)
                }))
            }
            return c.post
        }

        beforeEach( ()=> {
            client = new OverpassApi();
            timeoutsToClear = []
        })

        afterEach( ()=>{
            timeoutsToClear.forEach( (t:NodeJS.Timeout)=>clearTimeout(t) )
            jest.resetAllMocks()
            jest.useRealTimers()
            client.reset()
        })

        test ( 'self-hosted request sets Content-Type explicitly (not every transport infers one for a string body)',async  () => {
            const selfHostedPost = mockSelfHosted(client,{response:{status:200,data:'success',headers:{}}})

            await client.query("myquery");

            expect(selfHostedPost).toHaveBeenCalledWith(
                expect.anything(), expect.anything(),
                expect.objectContaining({headers: expect.objectContaining({'Content-Type':'text/plain'})}),
            )
        } );

        test ( 'self-hosted succeeds: no fallback to mirrors',async  () => {
            const selfHostedPost = mockSelfHosted(client,{response:{status:200,data:'success',headers:{}}})
            const mirrorPost = mockMirrors(client,{response:{status:200,data:'should-not-be-used',headers:{}}})

            const result = await client.query("myquery");

            expect(selfHostedPost).toHaveBeenCalledTimes(1)
            expect(mirrorPost).not.toHaveBeenCalled()
            expect(result).toBe('success');
        } );

        test ( 'self-hosted succeeds with a remark (200, partial result): accepted as-is',async  () => {
            const remarkBody = '{"remark":"runtime error: Query timed out","elements":[]}'
            mockSelfHosted(client,{response:{status:200,data:remarkBody,headers:{}}})

            const result = await client.query("myquery");

            expect(result).toBe(remarkBody);
        } );

        test ( 'self-hosted returns HTTP 400: falls back and succeeds on a mirror',async  () => {
            const selfHostedPost = mockSelfHosted(client,{response:{status:400,data:'bad request',headers:{}}})
            const mirrorPost = mockMirrors(client,{response:{status:200,data:'from-mirror',headers:{}}})

            const result = await client.query("myquery");

            expect(selfHostedPost).toHaveBeenCalledTimes(1)
            expect(mirrorPost).toHaveBeenCalledTimes(3) // 3 mirrors
            expect(result).toBe('from-mirror');
        } );

        test ( 'self-hosted network error, mirrors also fail: rejects',async  () => {
            const error =  new Error('error-text')
            mockSelfHosted(client,{error})
            mockMirrors(client,{error})

            await expect( async ()=> {await client.query("myquery")}).rejects.toThrow('All promises were rejected')

        } );
        test ( 'self-hosted and mirrors all time out: resolves undefined',async  () => {

            jest.useFakeTimers()
            mockSelfHosted(client,{noResponse:true})
            mockMirrors(client,{noResponse:true})

            let result:string|JSON|undefined = 'some dummy value'
            client.query("myquery",5000).then( res=> { result = res});

            // self-hosted gets min(5000/2, 5000)=2500ms, the mirror race gets the remaining ~2500ms
            jest.advanceTimersByTime(5000)
            jest.advanceTimersByTime(100)
            await jest.runAllTimersAsync()

            expect(result).toBeUndefined()

        } );

        test ( 'self-hosted goes through IncyclistRestApiClient (getRestClient()), never through the manual post() path used by mirrors',async  () => {
            const getRestClientMock = jest.fn(()=>({post: jest.fn().mockResolvedValue({status:503,data:'unavailable',headers:{}})}))
            ;(client as any).getRestClient = getRestClientMock
            const mirrorPost = mockMirrors(client,{response:{status:200,data:'from-mirror',headers:{}}})

            await client.query("myquery");

            expect(getRestClientMock).toHaveBeenCalledTimes(1)
            expect(mirrorPost).toHaveBeenCalledTimes(3)
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

    describe ( 'post', () => {

        let client:OverpassApi

        beforeEach( ()=> {
            client = new OverpassApi();
        })

        test ('uses the fetch binding when available (desktop)', async () => {
            const fetchMock = jest.fn().mockResolvedValue({ok:true, status:200, statusText:'OK', headers:{}, data:'result'})
            ;(client as any).getBindings = jest.fn( ()=> ({fetch:{fetch:fetchMock}}) )

            const res = await (client as any).post('https://overpass.example/api/interpreter', 'myquery')

            expect(fetchMock).toHaveBeenCalledWith('https://overpass.example/api/interpreter', expect.objectContaining({
                method: 'POST',
                body: 'myquery',
                referrerPolicy: 'unsafe-url',
                headers: expect.objectContaining({ Referer: 'https://incyclist.com' })
            }))
            expect(res.data).toBe('result')
            expect(res.status).toBe(200)
        })

        test ('propagates the error when the fetch binding request fails (no legacy fallback)', async () => {
            const error = new Error('boom')
            const fetchMock = jest.fn().mockRejectedValue(error)
            ;(client as any).getBindings = jest.fn( ()=> ({fetch:{fetch:fetchMock}}) )
            const legacySpy = jest.spyOn(client as any,'postViaNodeHttps')

            await expect( (client as any).post('https://overpass.example/api/interpreter', 'myquery') ).rejects.toThrow('boom')

            expect(fetchMock).toHaveBeenCalled()
            expect(legacySpy).not.toHaveBeenCalled()
        })

        test ('uses the legacy path when no fetch binding is registered (e.g. mobile)', async () => {
            ;(client as any).getBindings = jest.fn( ()=> ({}) )
            const legacySpy = jest.spyOn(client as any,'postViaNodeHttps').mockResolvedValue({data:'legacy',status:200,statusText:'OK',headers:{}})

            const res = await (client as any).post('https://overpass.example/api/interpreter', 'myquery')

            expect(legacySpy).toHaveBeenCalled()
            expect(res.data).toBe('legacy')
        })

    })

    describe ( 'self-hosted URL override (OVERPASS_API user setting)', () => {

        let client:OverpassApi

        beforeEach( ()=> {
            client = new OverpassApi();
        })

        test ('a configured OVERPASS_API setting overrides the compiled-in default', async () => {
            const selfHostedPost = jest.fn().mockResolvedValue({status:200,data:'from-preprod',headers:{}})
            ;(client as any).getRestClient = jest.fn(()=>({post:selfHostedPost}))
            ;(client as any).getUserSettings = jest.fn( ()=> ({ get: () => 'http://192.168.121.149/api/v1/interpreter', getValue: (_key:string, defValue:string) => defValue }) )

            await client.query("myquery");

            expect(selfHostedPost).toHaveBeenCalledWith('http://192.168.121.149/api/v1/interpreter', 'myquery', expect.anything())
        })

        test ('falls back to the compiled-in default when the setting is not configured', async () => {
            const selfHostedPost = jest.fn().mockResolvedValue({status:200,data:'from-default',headers:{}})
            ;(client as any).getRestClient = jest.fn(()=>({post:selfHostedPost}))
            ;(client as any).getUserSettings = jest.fn( ()=> ({ get: (_key:string, defValue:string) => defValue, getValue: (_key:string, defValue:string) => defValue }) )

            await client.query("myquery");

            expect(selfHostedPost).toHaveBeenCalledWith('https://overpass.incyclist.com/api/v1/interpreter', 'myquery', expect.anything())
        })

        test ('falls back to the compiled-in default if settings are not yet initialized', async () => {
            const selfHostedPost = jest.fn().mockResolvedValue({status:200,data:'from-default',headers:{}})
            ;(client as any).getRestClient = jest.fn(()=>({post:selfHostedPost}))
            ;(client as any).getUserSettings = jest.fn( ()=> ({ get: () => { throw new Error('Settings are not yet initialized') }, getValue: (_key:string, defValue:string) => defValue }) )

            await client.query("myquery");

            expect(selfHostedPost).toHaveBeenCalledWith('https://overpass.incyclist.com/api/v1/interpreter', 'myquery', expect.anything())
        })

    })

})

