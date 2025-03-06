import {IntervalsApi} from "./api";
import { AxiosFormPost } from "../../../../../__tests__/utils/formPost";
import { IntervalsUploadProps } from "./types";



describe ('Intervals API',()=> {


    describe( 'upload',()=>{
        let api;

        beforeEach( ()=>{
            api = new IntervalsApi()
            
            api.isAuthenticated = jest.fn().mockReturnValue(true)
            api.createForm = jest.fn()
            
        })

        test('valid file',async ()=>{
            const info:IntervalsUploadProps = {
                format:'tcx',
                name:'Intervals Upload Test',                
                description:'test',
                externalId:'1234'
            }

            const file = '/temp/test.tcx'
            
            // Mock Upload response
            api.postForm = jest.fn().mockResolvedValue({data:{
                icu_athlete_id: 'a4711',
                id: 'i12345',
                activities: [ { icu_athlete_id: 'a4711', id: 'i12345' } ]
              }})

            api.init({accessToken:'TEST-TOKEN'})
            const res = await api.upload(file,info)
            expect(res).toMatchObject({externalId:'1234', intervalsId:'i12345'})
        })


    })




})