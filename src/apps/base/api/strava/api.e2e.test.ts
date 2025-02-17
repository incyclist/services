import {StravaApi} from "./api";
import dotenv from 'dotenv';
import { AxiosFormPost } from "../../../../../__tests__/utils/formPost";
import { DuplicateError, StravaUploadProps, SummaryActivity } from "./types";

dotenv.config();

const clientId = process.env.STRAVA_CLIENT_ID
const clientSecret = process.env.STRAVA_CLIENT_SECRET
const accessToken = process.env.STRAVA_ACCESS_TOKEN
const refreshToken = process.env.STRAVA_REFRESH_TOKEN


describe ('Strava API',()=> {


    describe( 'upload',()=>{
        let api;

        beforeEach( ()=>{
            api = new StravaApi()
            
            api.getFormBinding = jest.fn( ()=> new AxiosFormPost())
            api.init( { clientId,clientSecret,accessToken, refreshToken})
        })

        afterEach( ()=>{

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

            // Please provide a new file here for every test run, otherwise you'll get an error
            // (file is duplicate of ....)
            const file = '/mnt/c/temp/Incyclist/activities/Incyclist Ride-20240311222127.tcx'
            //const file = '__tests__/data/activities/test.tcx'
            const res = await api.upload(file,info)
            expect(res).toMatchObject({externalId:'1234.tcx', stravaId:expect.anything()})
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
           
            const file = '__tests__/data/activities/test.tcx'
            await expect( async () =>{ await api.upload(file,info)}).rejects.toThrow(DuplicateError)
            
        })

    })
  

    describe( 'getLoggedInAthlete',()=>{
        let api;
        let refresh

        beforeEach( ()=>{
            api = new StravaApi()           
            api.init( { clientId,clientSecret,accessToken, refreshToken})
        })

        test('normal use',async ()=>{
            const res = await api.getLoggedInAthlete()
            expect(res).toMatchObject({firstname:'Try', lastname:'Incyclist.com'})
        })
    })

    describe( 'getLoggedInAthleteActivities',()=>{
        let api;
        let refresh

        beforeEach( ()=>{
            api = new StravaApi()           
            api.init( { clientId,clientSecret,accessToken, refreshToken})
        })

        test('normal use',async ()=>{
            const res = await api.getLoggedInAthleteActivities()
            expect(Array.isArray(res)).toBe(true)
            res.forEach( e => console.log(e))
        })
        test('pagination',async ()=>{
            let page = 1;
            let done = false
            const res:Array<SummaryActivity> = []

            while (!done) {
                const activities = await api.getLoggedInAthleteActivities({page})
                if (Array.isArray(activities) && activities.length>0) {   
                    console.log('page', page, 'records', activities.length )                 
                    res.push(...activities)
                    page++

                }
                else {
                    console.log('page', page, 'result', activities )                 
                    done = true;
                }
            }
            
            console.log(res.length)
            
        })
    })

    describe( 'getActivityById',()=>{
        let api;
        let refresh

        beforeEach( ()=>{
            api = new StravaApi()           
            api.init( { clientId,clientSecret,accessToken, refreshToken})
        })

        test('normal use',async ()=>{
            /*
            const activities = await api.getLoggedInAthleteActivities()
            const id = activities[0].id
            */
           const id = 13438210563

            const res = await api.getActivityById(id)
            expect(res.id).toEqual(id)
            console.log(res)
            
        })
    })


    describe( 'exportActivcityGPX',()=>{
        let api;
        let refresh

        beforeEach( ()=>{
            api = new StravaApi()           
            api.init( { clientId,clientSecret,accessToken, refreshToken})
        })

        test('normal use',async ()=>{
            const id = 111
            const res = await api.getActivityStream(id,['latlng,altidue,grade_smooth'])
            
            console.log( JSON.stringify(res) )
            
        })
    })

})