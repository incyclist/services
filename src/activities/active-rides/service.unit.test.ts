import {ActiveRidesService, useActiveRides} from './service'
describe('ActiveRides',()=>{
    test('init',()=>{

        const service:ActiveRidesService = useActiveRides()
        const observer = service.init('123')

        expect(observer).toBeDefined()

    })
})