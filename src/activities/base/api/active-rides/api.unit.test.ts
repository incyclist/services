

import { AxiosInstance, AxiosResponse } from "axios"
import { Inject } from "../../../../base/decorators"
import { IncyclistActiveRidesApi } from "./api"
import { ActiveRideEntry } from "../../../active-rides/types"

const data:ActiveRideEntry[] = [
    {"user":{"id":"a7257c94-6c88-4687-a410-f3d6c338275d","name":"","weight":90},"ride":{"title":"MA_BunOriDeia","type":"video","startPos":1227.9808333333326,"realityFactor":100,"isLap":false,"routeHash":"43918f33558230e89ea530929ac7d416","distance":86416},"bike":{"name":"Daum Classic (COM3)","interface":"Daum Classic"},"sessionId":"1e9471b7-b9df-4264-9dc6-2a2ba048c4aa","tsLastUpdate":1741875984888,"currentDuration":2364.174,"currentRideDistance":6883.870277777663,"id":"411b5001-d530-4a85-97e8-90aa30830e34","currentPosition":{"lat":39.72786550647162,"lng":2.7302143655713644,"elevation":534.1435329815379,"slope":6.699999999999916},"currentSpeed":6,"currentPower":95},{"user":{"id":"66c5b6d0-6e8c-4a40-a967-dfb5ed08f464","name":"Walter","weight":68,"ftp":100},"ride":{"title":"Grimone 3 - Col de Grimone: descent","type":"video","startPos":0,"realityFactor":100,"isLap":false,"routeHash":"0188c190ae409261addc7cc5e47957fc","distance":34128.38422106632},"bike":{"name":"Tacx FE 44984","interface":"ANT-FE"},"sessionId":"9e0afbed-e235-44e9-b180-65b86e30ae8c","tsLastUpdate":1741875985127,"currentDuration":4.006,"currentRideDistance":8.952065472485305,"id":"1cf7e1cb-a01a-4028-8cc7-b9bf37323808","currentPosition":{"lat":44.6917440449804,"lng":5.653830724081334,"elevation":1322.43,"slope":0},"currentSpeed":9.368987254128438,"currentPower":107}]

type MockDefinition  = {
    error?:Error, 
    response?:Partial<AxiosResponse>
    userSettings?: object
}

describe ('ActiveRides API',()=>{


    const setupMocks = ( api, props:MockDefinition ) => {
        let mock

        mock = {}

        if (props.error || props.response) {
            mock.apiGet = jest.fn( ()=>{
                if (props.response) return props.response
                if (props.error) throw props.error
            })
            api.getApi = jest.fn().mockReturnValue({get:mock.apiGet})
        }

        const userSettings = props.userSettings??{}
        mock.userSettingsGet = jest.fn( (k,d) => userSettings[k]??d)
        Inject('UserSettings', { get: mock.userSettingsGet})
        return mock
    }

    const resetMocks = (api) => {
        api.reset()
        jest.clearAllMocks()
    }

    const prepareResponse = (data:ActiveRideEntry[], response?:Partial<AxiosResponse>):Partial<AxiosResponse> => {
        const resp = response??{
            status: 200,
            statusText: 'OK'
        }
        resp.data = { activeRides: data}
        return resp
    }

    describe('getAll', ()=>{

        let api: IncyclistActiveRidesApi
        let apiGet

        beforeEach( ()=>{
            api = new IncyclistActiveRidesApi()
        })

        afterEach( ()=>{ 
            resetMocks(api)
        })


        test('typical call', async ()=>{          
            const mock = setupMocks(api,{response:prepareResponse(data)})
            const routeHash = '43918f33558230e89ea530929ac7d416'
            const list = await api.getAll({routeHash })           
            expect(list).toMatchObject(data)
            expect(mock.apiGet).toHaveBeenCalledWith('https://dlws.incyclist.com/api/v1/active-rides/',{params:{routeHash}})
        })
        test('no active rides', async ()=>{          
            setupMocks(api,{response:prepareResponse([])})
            const list = await api.getAll({routeHash:'43918f33558230e89ea530929ac7d416' })           
            expect(list).toEqual( [])
        })
        test('no params', async ()=>{          
            const mock = setupMocks(api,{response:prepareResponse(data) })
            const list = await api.getAll()           
            expect(list).toMatchObject(data)
            expect(mock.apiGet).toHaveBeenCalledWith('https://dlws.incyclist.com/api/v1/active-rides/')
        })
        test('no success response status code', async ()=>{          
            const mock = setupMocks(api,{response:prepareResponse(data,{status:301}) })
            const list = await api.getAll()           
            expect(list).toEqual( [])
        })
        test('api returns error', async ()=>{          
            const mock = setupMocks(api,{error:new Error('X') })
            const list = await api.getAll()           
            expect(list).toEqual( [])
        })

    })

})