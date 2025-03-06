import {IntervalsApi} from "./api";
import dotenv from 'dotenv';
import { AxiosFormPost } from "../../../../../__tests__/utils/formPost";
import { IntervalsUploadProps } from "./types";

dotenv.config();

const accessToken = process.env.INTERVALS_ACCESS_TOKEN


describe ('Intervals.icu API',()=> {


    describe( 'upload',()=>{
        let api;

        beforeEach( ()=>{
            api = new IntervalsApi()
            
            api.getFormBinding = jest.fn( ()=> new AxiosFormPost())
            api.init( { accessToken})
        })

        afterEach( ()=>{

        })

        test('valid file',async ()=>{
            const info:IntervalsUploadProps = {
                format:'tcx',
                name:'Intervals Upload Test',                
                description:'test',
                externalId:'1234'

            }

            // Please provide a new file here for every test run, otherwise you'll get an error
            // (file is duplicate of ....)
            //const file = '/mnt/c/temp/Incyclist/activities/Incyclist Ride-20240311222127.tcx'
            const file = '__tests__/data/activities/test.tcx'
            const res = await api.upload(file,info)
            expect(res).toMatchObject({externalId:'1234', intervalsId:expect.anything()})
        })

        test('duplicate',async ()=>{

            // duplicates are not signalled, so the flow should work just fine
            const info:IntervalsUploadProps = {
                format:'tcx',
                name:'Intervals Upload Test',                
                description:'test',
                externalId:'1234'
            }

            const file = '__tests__/data/activities/test.tcx'
            const res = await api.upload(file,info)
            expect(res).toMatchObject({externalId:'1234', intervalsId:expect.anything()})

            const request2 = {...info, description:'test 2',externalId:'1235'}
            const res2 = await api.upload(file,request2)
            expect(res2).toMatchObject({externalId:'1235', intervalsId:expect.anything()})

            

        })

    })

    

    describe( 'getLoggedInAthlete',()=>{
        let api;
        let refresh

        beforeEach( ()=>{
            api = new IntervalsApi()           
            api.init( {accessToken})
        })

        test('normal use',async ()=>{
            const res = await api.getLoggedInAthlete()
            expect(res).toMatchObject({name:'Incyclist', sex:'M'})
        })
    })


})