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
  


})