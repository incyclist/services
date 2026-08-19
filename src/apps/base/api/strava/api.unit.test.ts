import {StravaApi} from "./api";
import { AxiosFormPost } from "../../../../../__tests__/utils/formPost";
import { StravaConfig, StravaUploadProps } from "./types";



describe ('Strava API',()=> {


    describe( 'upload',()=>{
        let api;

        beforeEach( ()=>{
            api = new StravaApi()
            
            api.getFormBinding = jest.fn( ()=> new AxiosFormPost())
            api.isAuthenticated = jest.fn().mockReturnValue(true)
            api.verifyToken = jest.fn().mockResolvedValue(true) 
            api.waitForReady = jest.fn().mockResolvedValue(undefined)
            
        })

        test('valid file',async ()=>{
            const info:StravaUploadProps = {
                format:'tcx',
                name:'Strava Upload Test',                
                description:'test',
                trainer:false,
                commute:false,
                externalId:'1234'

            }

            const file = '/temp/test.tcx'
            
            // Mock Upload response
            api.createUpload = jest.fn().mockResolvedValue({externalId:'1234',stravaId:1234})
            // Mock get response
            api.get = jest.fn().mockResolvedValue({data:{status:'Your activity is ready.',activity_id:'XYZ', external_id:'1234'}})

            const res = await api.upload(file,info)
            expect(res).toMatchObject({externalId:'1234', stravaId:'XYZ'})
        })

        test('duplicate',async ()=>{
            const info:StravaUploadProps = {
                format:'tcx',
                name:'Strava Upload Test',                
                description:'test',
                trainer:false,
                commute:false,
                externalId:'1234'

            }
           
            const file = '/temp/test.tcx'
            
            // Mock Upload response
            api.createUpload = jest.fn().mockResolvedValue({externalId:'1234',stravaId:1234})
            // Mock get response
            api.get = jest.fn().mockResolvedValue({data:{
                id: 13549892109,
                id_str: '13549892109',
                external_id: null,
                error: "1234.tcx duplicate of <a href='/activities/12699650316' target='_blank'>Strava Upload Test</a>",
                status: 'There was an error processing your activity.',
                activity_id: null
              }})

            await expect( async () =>{ await api.upload(file,info)}).rejects.toThrow('Activity already exists: id=12699650316')
            
        })

    })


    describe( 'refreshToken',()=>{
        let api;
        let restClient
        let settings

        const initialConfig:StravaConfig = {
            accessToken:'old-access-token',
            refreshToken:'old-refresh-token',
            clientId:'some-client-id',
            clientSecret:'some-client-secret'
        }

        beforeEach( ()=>{
            api = new StravaApi()
            api.init({...initialConfig})

            restClient = { request: jest.fn() }
            settings = { get: jest.fn( (key,def) => def) }

            api.getApi = jest.fn( ()=> restClient)
            api.getUserSettings = jest.fn( ()=> settings)
        })

        test('calls the auth-server refresh endpoint, not Strava directly, and sends only the refresh token',async ()=>{
            restClient.request.mockResolvedValue( {data:{
                access_token:'new-access-token',
                refresh_token:'new-refresh-token',
                expires_at: 1700000000,
                expires_in: 21600
            }})

            await api.refreshToken()

            expect(restClient.request).toHaveBeenCalledTimes(1)
            const request = restClient.request.mock.calls[0][0]

            expect(request.method).toBe('post')
            expect(request.url).toBe('https://auth.incyclist.com/strava/refresh')
            expect(request.data).toEqual({refresh_token:'old-refresh-token'})

            // must never read/send client_id or client_secret for this call
            expect(request.data.client_id).toBeUndefined()
            expect(request.data.client_secret).toBeUndefined()
            expect(JSON.stringify(request.data)).not.toMatch(/client_?[iI]d|client_?[sS]ecret/)
        })

        test('updates access token, refresh token and expiration on success',async ()=>{
            restClient.request.mockResolvedValue( {data:{
                access_token:'new-access-token',
                refresh_token:'new-refresh-token',
                expires_at: 1700000000,
                expires_in: 21600
            }})

            const tokenUpdated = jest.fn()
            api.observer.on('token.updated', tokenUpdated)

            await api.refreshToken()

            expect(api.config.accessToken).toBe('new-access-token')
            expect(api.config.refreshToken).toBe('new-refresh-token')
            expect(api.config.expiration).toEqual( new Date(1700000000*1000))
            expect(tokenUpdated).toHaveBeenCalledWith(api.config)
        })

        test('respects a STRAVA_AUTH_SERVER_URL settings override',async ()=>{
            settings.get = jest.fn( (key,def) => key==='STRAVA_AUTH_SERVER_URL' ? 'https://auth.staging.incyclist.com' : def)
            restClient.request.mockResolvedValue( {data:{access_token:'a',refresh_token:'b',expires_at:1700000000,expires_in:1}})

            await api.refreshToken()

            const request = restClient.request.mock.calls[0][0]
            expect(request.url).toBe('https://auth.staging.incyclist.com/strava/refresh')
        })

        test('does not throw and logs the error when the auth-server call fails',async ()=>{
            restClient.request.mockRejectedValue( new Error('network error'))

            await expect( api.refreshToken()).resolves.not.toThrow()

            // config must remain unchanged
            expect(api.config.accessToken).toBe('old-access-token')
            expect(api.config.refreshToken).toBe('old-refresh-token')
        })

    })


    describe( 'getActivityStream',()=>{
        const testData = [
            {"type":"latlng","data":[[44.19936,-0.927192],[44.19934,-0.927295],[44.199322,-0.927394],[44.199302,-0.927492],[44.199279,-0.927589],[44.199257,-0.927686],[44.199237,-0.927784],[44.199218,-0.927883]],"series_type":"distance","original_size":8,"resolution":"high"},
            {"type":"grade_smooth","data":[0.3,0.6,0.3,0,0,0,0.3,0.6],"series_type":"distance","original_size":8,"resolution":"high"},
            {"type":"distance","data":[264.8,273.3,281.5,289.6,297.7,305.8,314,322.2],"series_type":"distance","original_size":8,"resolution":"high"}
        ]

        let api;

        beforeEach( ()=>{
            api = new StravaApi()
            
            api.getFormBinding = jest.fn( ()=> new AxiosFormPost())
            api.isAuthenticated = jest.fn().mockReturnValue(true)
            api.verifyToken = jest.fn().mockResolvedValue(true)                     
        })

        test('no parameters',async ()=>{
            const expected = testData.filter( ds => ds.type==='distance')
            api.get = jest.fn().mockResolvedValue( {data:expected})

            const data = await api.getActivityStream(1234)
            expect(data).toBe(expected)
            expect(api.get).toHaveBeenCalledWith('/activities/1234/streams')
        })

        test('with parameters',async ()=>{
            const expected = testData.filter( ds => ds.type==='distance' || ds.type==='latlng')
            api.get = jest.fn().mockResolvedValue( {data:expected})

            const data = await api.getActivityStream(1234,['distance','latlng'])
            expect(data).toBe(expected)
            expect(api.get).toHaveBeenCalledWith('/activities/1234/streams?keys=distance,latlng')
        })
        test('error',async ()=>{
            const expected = testData.filter( ds => ds.type==='distance' || ds.type==='latlng')
            api.get = jest.fn().mockRejectedValue( new Error('some error'))

            const data = await api.getActivityStream(1234,['distance','latlng'])
            expect(data).toEqual( {id:1234, error:'getActivityStream failed: some error'})
        })

    })
  


})