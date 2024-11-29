import { ActivitiesRepository } from "./db"
import fs from 'fs/promises'

describe('ActivityDB',()=>{

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