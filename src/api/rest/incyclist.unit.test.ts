import { IncyclistRestApiClient } from "./incyclist"

describe('IncyclistRestApiClient',()=>{

    describe('getClient',()=>{

        test('desktop',()=>{
            const api = IncyclistRestApiClient.getClient()
            expect(api).toBeDefined()
        })
    })
})