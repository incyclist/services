import { MapArea } from "./MapArea"
import { MapAreaService, useMapArea } from "./service"
import { FreeRideDataSet, IMapArea } from "./types"

describe('MapAreaService', () => {

    describe('load', () => {

        let service: MapAreaService

        const setupMocks = (s,data) => {

            const addMap = (str,idx) :Partial<IMapArea> => {
                const [location, radius, bounds] = str.split(':')  

                const [neLat,neLng,swLat,swLng] = bounds.replace('[','').replace(']','').split(',')
                const data: Partial<FreeRideDataSet> = {}
                const boundary = { northeast:{lat:Number(neLat),lng:Number(neLng)}, southwest:{lat:Number(swLat),lng:Number(swLng)} }
                const map = new MapArea(data as FreeRideDataSet,location,boundary)
                s.maps[location] = {map,radius:Number(radius),lastUsed:Date.now()}  
                return map
            }

            s.maps = {}
            data.forEach((d,idx) => { addMap(d,idx) })  
            s.loadMap = jest.fn()

            return { loadMap:s.loadMap }
        }


        afterEach(() => {
            useMapArea().reset()
            jest.restoreAllMocks()
        })


        test('location already covered', async () => {  

            const location = {lat:26.687131980133724,lng:-80.03457945559651}
            const testData = [
                "26.68537966608196,-80.03481961660725:1000:[26.69436287103533,-80.02476550851868,26.67639646112859,-80.04487372469582]",
                "26.686533002859395,-80.03695084082857:1502.6857675938215:[26.700031937090202,-80.02184252283412,26.67303406862859,-80.05205915882301]"                
            ]

            service = new MapAreaService()
            const mocks = setupMocks(service,testData)
            await service.load(location)

            expect(mocks.loadMap).toHaveBeenCalledTimes(0)

        })

        test('location data not covered', async () => {  

            const location = {lat:40.7127281,lng:-74.0060152}
            const testData = [
                "26.68537966608196,-80.03481961660725:1000:[26.69436287103533,-80.02476550851868,26.67639646112859,-80.04487372469582]",
                "26.686533002859395,-80.03695084082857:1502.6857675938215:[26.700031937090202,-80.02184252283412,26.67303406862859,-80.05205915882301]"                
            ]

            service = new MapAreaService()
            const mocks = setupMocks(service,testData)
            await service.load(location)

            expect(mocks.loadMap).toHaveBeenCalledTimes(1)

        })

    })

})