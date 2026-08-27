import { ActivitiesRepository } from "./db"
import { ActivityInfo } from "../model"
import { getBindings } from "../../../api"
import { IAppInfo } from "../../../api/appInfo"
import fs from 'fs/promises'

describe('ActivityDB',()=>{

    describe('search', ()=>{

        let db:ActivitiesRepository

        const buildActivity = (id:string, rideTime:number, startTime:number=1709745255915):ActivityInfo => ({
            summary: {
                id,
                title: 'Incyclist Ride',
                name: `Incyclist Ride-${id}`,
                routeId: 'route-1',
                routeHash: 'hash-1',
                startTime,
                rideTime,
                distance: 1000,
                startPos: 0,
                realityFactor: 100,
                totalElevation: 10,
                uploadStatus: [],
            }
        } as unknown as ActivityInfo)

        const setChannel = (channel:'mobile'|'desktop') => {
            getBindings().appInfo = {
                getChannel: jest.fn().mockReturnValue(channel)
            } as unknown as IAppInfo
        }

        beforeEach(()=>{
            db = new ActivitiesRepository()
        })

        afterEach(()=>{
            db.reset()
            delete getBindings().appInfo
        })

        test('on mobile, a saved ride shorter than 30s is still returned', ()=>{
            setChannel('mobile');
            (db as unknown as {activities:Array<ActivityInfo>}).activities = [buildActivity('short-ride', 15)]

            const result = db.search({})

            expect(result.map(a=>a.summary.id)).toContain('short-ride')
        })

        test('on desktop, a legacy ride (before rollout) shorter than 30s is hidden', ()=>{
            setChannel('desktop');
            (db as unknown as {activities:Array<ActivityInfo>}).activities = [buildActivity('legacy-short-ride', 15, new Date('2026-08-01').getTime())]

            const result = db.search({})

            expect(result.map(a=>a.summary.id)).not.toContain('legacy-short-ride')
        })

        test('on desktop, a new ride (after rollout) shorter than 30s is still returned', ()=>{
            setChannel('desktop');
            (db as unknown as {activities:Array<ActivityInfo>}).activities = [buildActivity('new-short-ride', 15, new Date('2026-08-28').getTime())]

            const result = db.search({})

            expect(result.map(a=>a.summary.id)).toContain('new-short-ride')
        })

        test('on desktop, a ride shorter than 1s is hidden regardless of date', ()=>{
            setChannel('desktop');
            (db as unknown as {activities:Array<ActivityInfo>}).activities = [buildActivity('near-zero-ride', 0.5, new Date('2026-08-28').getTime())]

            const result = db.search({})

            expect(result.map(a=>a.summary.id)).not.toContain('near-zero-ride')
        })

        test('without appInfo binding, desktop filtering is applied by default', ()=>{
            (db as unknown as {activities:Array<ActivityInfo>}).activities = [buildActivity('legacy-short-ride', 15, new Date('2026-08-01').getTime())]

            const result = db.search({})

            expect(result.map(a=>a.summary.id)).not.toContain('legacy-short-ride')
        })

    })

    describe('migrate', ()=>{

        let db:ActivitiesRepository
        let mocks

        const setupMocks = (db)=>{
            db.getRouteList = jest.fn().mockReturnValue({
                getRouteDescription:jest.fn().mockReturnValue( { originalName:'ORIGINAL', title: 'TEST'}),
            })
            db.writeDetails = jest.fn()
            db.writeRepo = jest.fn()
        }
        const cleanupMocks = (db)=>{
            db.reset()
        }

        const SummaryTemplate = 
        {
            id: "1b35ba0c-6d52-409f-bc47-fa816c037620-1709745367983",
            title: "Incyclist Ride",
            name: "Incyclist Ride-20240306181607",
            routeId: "dfadb5e137909358830c4e269be1c094",
            routeHash: "7202de96e9004a414e21e7237d91f80b",
            startTime: 1709745255915,
            rideTime: 104.926,
            distance: 1329.1267758900326,
            startPos: 0,
            realityFactor: 100,
            totalElevation: 150000,
            uploadStatus: [],
        }

        beforeEach(async ()=>{
            db = new ActivitiesRepository()
            setupMocks(db)
            mocks = db
        })

        afterEach(async ()=>{
            cleanupMocks(db)
            
        })

        test(('v0 GPX'),async ()=>{

            const str = await fs.readFile('__tests__/data/activities/migrate.json','utf-8')
            const details = JSON.parse(str)
            const summary = { ...SummaryTemplate,                 
                    id: "1b35ba0c-6d52-409f-bc47-fa816c037620-1709745367983",
                    title: "Incyclist Ride",
                    name: "Incyclist Ride-20240306181607",
                    totalElevation: 150000,
                }
  
            db.migrate({details,summary})

            expect(summary.title).toBe('skyrunners hausrunde')
            expect(summary.name).toBe('Incyclist Ride-20240306181607')
            expect(summary.totalElevation).toBeCloseTo(1,0)
            expect(details.route.name).toBe('skyrunners hausrunde')
            expect(details.startTime).toBe('2024-03-06T17:14:15.915Z')
            
            expect(mocks.writeDetails).toHaveBeenCalledTimes(1)
            expect(mocks.writeRepo).toHaveBeenCalledTimes(1)

        })

        test(('v1 GPX' ),async ()=>{

            const str = await fs.readFile('__tests__/data/activities/v1.json','utf-8')
            const details = JSON.parse(str)
            const summary = {...SummaryTemplate,
                    id: "84b0181f-872a-4955-ba10-9237d52c94fa",
                    title: "Incyclist Ride",
                    name: "Incyclist Ride-20240522165548",
            }
  
            db.migrate({details,summary})

            expect(summary.title).toBe("Giro d'Italia 2024 Stage 16: Livigno - Santa Cristina Valgardena/St. Christina in Gröden (Monte Pana)")
            expect(summary.name).toBe('Incyclist Ride-20240522165548')
            expect(summary.totalElevation).toBeCloseTo(109,0)
            expect(details.route.name).toBe("Giro d'Italia 2024 Stage 16: Livigno - Santa Cristina Valgardena/St. Christina in Gröden (Monte Pana)")
            expect(details.startTime).toBe( '2024-05-22T14:55:49.000Z')
            
            expect(mocks.writeDetails).toHaveBeenCalledTimes(1)
            expect(mocks.writeRepo).toHaveBeenCalledTimes(1)

        })


        test(('v1 Video' ),async ()=>{

            const str = await fs.readFile('__tests__/data/activities/v1.json','utf-8')
            const details = JSON.parse(str)

            details.routeType = 'Video'

            const summary = {...SummaryTemplate,
                    id: "84b0181f-872a-4955-ba10-9237d52c94fa",
                    title: "Incyclist Ride",
                    name: "Incyclist Ride-20240522165548",
            }
  
            db.migrate({details,summary})

            expect(summary.title).toBe("TEST")
            expect(summary.name).toBe('Incyclist Ride-20240522165548')
            expect(summary.totalElevation).toBeCloseTo(109,0)
            expect(details.route.name).toBe("ORIGINAL")
            expect(details.route.title).toBe("TEST")
            expect(details.startTime).toBe( '2024-05-22T14:55:49.000Z')
            
            expect(mocks.writeDetails).toHaveBeenCalledTimes(1)
            expect(mocks.writeRepo).toHaveBeenCalledTimes(1)

        })

    })    

})