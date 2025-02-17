import {StravaApi} from "./api";
import { AxiosFormPost } from "../../../../../__tests__/utils/formPost";
import { StravaUploadProps } from "./types";



describe ('Strava API',()=> {


    describe( 'upload',()=>{
        let api;

        beforeEach( ()=>{
            api = new StravaApi()
            
            api.getFormBinding = jest.fn( ()=> new AxiosFormPost())
            api.isAuthenticated = jest.fn().mockReturnValue(true)
            api.verifyToken = jest.fn().mockResolvedValue(true) 
            
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