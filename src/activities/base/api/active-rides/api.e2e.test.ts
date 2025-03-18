import { IncyclistActiveRidesApi } from "./api"

describe ('ActiveRides API E2E',()=>{

    describe('getAll', ()=>{

        test('no params', async ()=>{
            const api = new IncyclistActiveRidesApi()
            const list = await api.getAll()
            console.log( JSON.stringify(list))
    
        })

    })

})