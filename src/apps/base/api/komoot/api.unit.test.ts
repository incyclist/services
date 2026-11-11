import { KomootApi } from "./api"

describe('Komoot API',()=>{

    const setupMocks = (api, mocks:Record<string,any>) => {
        Object.keys(mocks).forEach( key => {
            api[key] = mocks[key]
        })
    }

    describe('login',()=>{
        let api: KomootApi
        let get = jest.fn()

        beforeEach( ()=>{
            api = new KomootApi()
            setupMocks(api,{
                get
            })                        
        })

        test('success',async ()=>{
            get.mockResolvedValue({
                data:{
                    email:'username@example.com',
                    display_name:'test',
                    username: '123'
                },
                status:200
            })

            expect(api.isAuthenticated()).toBe(false)
            const res = await api.login('username@example.com','password','123') 
            expect(api.isAuthenticated()).toBe(true)

            expect(res.authenticated).toBe(true)
            expect(res.email).toBe('username@example.com')
            expect(res.name).toBe('test')
            expect(res.id).toBe('123')

        })

        test('4xx response code',async ()=>{
            get.mockResolvedValue({
                status:403
            })

            expect(api.isAuthenticated()).toBe(false)
            const res = await api.login('username@example.com','password','123') 
            expect(api.isAuthenticated()).toBe(false)

            expect(res.authenticated).toBe(false)
            expect(res.error).toBe('invalid credentials')

        })

        test('komoot rejects ',async ()=>{
            get.mockRejectedValue(new Error('X'))

            expect(api.isAuthenticated()).toBe(false)
            const res = await api.login('username@example.com','password','123') 
            expect(api.isAuthenticated()).toBe(false)

            expect(res.authenticated).toBe(false)
            expect(res.error).toBe('X')

        })


    })

    describe('setAuth',()=>{
        let api: KomootApi

        beforeEach( ()=>{
            api = new KomootApi()
        })

        test('set auth',()=>{
            expect(api.isAuthenticated()).toBe(false)
            api.setAuth({username:'username@example.com',password:'password',userid:'123'}) 
            expect(api.isAuthenticated()).toBe(true)
        })

        test('delete auth',()=>{

            expect(api.isAuthenticated()).toBe(false)
            api.setAuth({username:'username@example.com',password:'password',userid:'123'}) 
            expect(api.isAuthenticated()).toBe(true)

            api.setAuth(null) 
            expect(api.isAuthenticated()).toBe(false)
        })

    })

    describe('getTours',()=>{
        let api: KomootApi
        let get = jest.fn()
        const tours = require('../../../../../__tests__/data/apps/komoot/tours.json')

        beforeEach( ()=>{
            api = new KomootApi()
            setupMocks(api,{
                get,
                isAuthenticated: jest.fn().mockReturnValue(true),                
                userid:'123',
                username: 'username@example.com',
                password: 'password'
            })                        
        })

        test('no params, no filter',async ()=>{
            get.mockResolvedValue({
                data: {_embedded:{tours}},
                status:200
            })

            const res = await api.getTours()
            expect(get).toHaveBeenCalledWith(
                    '/users/123/tours/',
                    {auth:{username:'username@example.com',password:'password'}}
            )
            expect(res).toEqual(tours)
            expect(res).toHaveLength(100)
        })

        test('with params, no filter',async ()=>{
            get.mockResolvedValue({
                data: {_embedded:{tours}},
                status:200
            })

            const res = await api.getTours({type:'tour_planned'})
            expect(get).toHaveBeenCalledWith(
                    '/users/123/tours/?type=tour_planned',
                    {auth:{username:'username@example.com',password:'password'}}
            )
            expect(res).toEqual(tours)
        })

        test('with params, with filter',async ()=>{
            get.mockResolvedValue({
                data: {_embedded:{tours}},
                status:200
            })

            const res1 = await api.getTours({type:'tour_planned'},{after:new Date()})
            expect(get).toHaveBeenCalledWith(
                    '/users/123/tours/?type=tour_planned',
                    {auth:{username:'username@example.com',password:'password'}}
            )
            expect(res1).toHaveLength(0)

            const res2 = await api.getTours({type:'tour_planned'},{after:new Date('2024-10-06T00:00:00.000Z')})
            expect(res2).toHaveLength(1)

            const res3 = await api.getTours({type:'tour_planned'},{sport:'racebike'})
            expect(res3).toHaveLength(67)

            const res4 = await api.getTours({type:'tour_planned'},{lastUpdateAfter:new Date('2025-01-01T00:00:00.000Z')})
            expect(res4).toHaveLength(1)


        })


        test('pagination',async ()=>{
            get.mockResolvedValue({
                data: {_embedded:{tours}},
                status:200
            })

            await api.getTours({page:0,limit:10})
            expect(get).toHaveBeenCalledWith(
                    '/users/123/tours/',
                    {auth:{username:'username@example.com',password:'password'}}
            )
        })

        test('4xx response code',async ()=>{
            get.mockResolvedValue({
                status:403
            })

            await expect( async()=> await api.getTours({page:0,limit:10} )).rejects.toThrow('invalid credentials')  

        })

        test('komoot rejects ',async ()=>{
            get.mockRejectedValue(new Error('X'))

            await expect( async()=> await api.getTours({page:0,limit:10} )).rejects.toThrow('X')  

        })


        
    })
    describe('getTourCoordinates',()=>{

        let api: KomootApi
        let get = jest.fn()
        const coordinates = require('../../../../../__tests__/data/apps/komoot/coordinates.json')

        beforeEach( ()=>{
            api = new KomootApi()
            setupMocks(api,{
                get,
                isAuthenticated: jest.fn().mockReturnValue(true),                
                userid:'123',
                username: 'username@example.com',
                password: 'password'
            })                        
        })

        test('success',async ()=>{
            get.mockResolvedValue({
                data: {items:coordinates},
                status:200
            })

            const res = await api.getTourCoordinates(12345)
            expect(get).toHaveBeenCalledWith(
                    '/tours/12345/coordinates',
                    {auth:{username:'username@example.com',password:'password'}}
            )
            expect(res).toEqual(coordinates)            
        })

        test('not found',async ()=>{
            get.mockResolvedValue({
                status:404
            })

            await expect( async()=>api.getTourCoordinates(12345) ).rejects.toThrow('not found')  

        })

        test('4xx response code',async ()=>{
            get.mockResolvedValue({
                status:403
            })

            await expect( async()=>api.getTourCoordinates(12345) ).rejects.toThrow('invalid credentials')  

        })

        test('komoot rejects ',async ()=>{
            get.mockRejectedValue(new Error('X'))

            await expect( async()=>api.getTourCoordinates(12345) ).rejects.toThrow('X')  

        })


        
    })

    describe('uploadTour',()=>{

        let api: KomootApi
        let request = jest.fn()
        const fitData = new Uint8Array([0x0E, 0x10, 0x00, 0x00])
        const auth = {username:'username@example.com',password:'password'}

        beforeEach( ()=>{
            request.mockReset()
            api = new KomootApi()
            setupMocks(api,{
                getApi: jest.fn().mockReturnValue({request}),
                getBaseUrl: jest.fn().mockReturnValue('https://api.komoot.de/v007'),
                userid:'123',
                username: 'username@example.com',
                password: 'password'
            })
        })

        test('success uploading fit file',async ()=>{
            request.mockResolvedValue({
                data: {id:1234, name:'Morning Ride', type:'tour_recorded'},
                status:200
            })

            const res = await api.uploadTour(fitData,'fit','racebike','Morning Ride')

            expect(request).toHaveBeenCalledTimes(1)
            const args = request.mock.calls[0][0]
            const url = new URL(args.url)

            expect(args.method).toBe('post')
            expect(url.origin+url.pathname).toBe('https://api.komoot.de/v007/tours/')
            expect(url.searchParams.get('data_type')).toBe('fit')
            expect(url.searchParams.get('sport')).toBe('racebike')
            expect(url.searchParams.get('name')).toBe('Morning Ride')
            expect(args.headers).toEqual({'Content-Type':'application/octet-stream'})
            expect(args.auth).toEqual(auth)
            expect(args.data).toBe(fitData)

            expect(res).toEqual({id:1234, name:'Morning Ride', type:'tour_recorded'})
        })

        test('success uploading gpx file',async ()=>{
            request.mockResolvedValue({ data: {id:5678}, status:200 })

            const gpx = new TextEncoder().encode('<gpx></gpx>')
            await api.uploadTour(gpx,'gpx','mtb','Trail')

            const args = request.mock.calls[0][0]
            expect(new URL(args.url).searchParams.get('data_type')).toBe('gpx')
            expect(args.headers).toEqual({'Content-Type':'application/gpx+xml'})
            expect(args.data).toBe(gpx)
        })

        test('accepts Buffer and ArrayBuffer',async ()=>{
            request.mockResolvedValue({ data: {id:1}, status:200 })

            const buffer = Buffer.from([1,2,3])
            await api.uploadTour(buffer,'fit','racebike','A')
            expect(request.mock.calls[0][0].data).toBe(buffer)

            const arrayBuffer = new Uint8Array([4,5,6]).buffer
            await api.uploadTour(arrayBuffer,'fit','racebike','B')
            expect(request.mock.calls[1][0].data).toBe(arrayBuffer)
        })

        test('encodes special characters in name',async ()=>{
            request.mockResolvedValue({ data: {id:1}, status:200 })

            const name = 'Ride & Run? 50% #1 ü'
            await api.uploadTour(fitData,'fit','racebike',name)

            const url = new URL(request.mock.calls[0][0].url)
            expect(url.searchParams.get('name')).toBe(name)
            expect(url.searchParams.get('sport')).toBe('racebike')
            expect(url.searchParams.get('data_type')).toBe('fit')
        })

        test('does not reject on error status in axios (validateStatus)',async ()=>{
            request.mockResolvedValue({ data: {id:1}, status:200 })

            await api.uploadTour(fitData,'fit','racebike','A')

            const {validateStatus} = request.mock.calls[0][0]
            expect(validateStatus(200)).toBe(true)
            expect(validateStatus(500)).toBe(true)
        })

        test('not authenticated (no userid)',async ()=>{
            setupMocks(api,{ userid: undefined })

            await expect( api.uploadTour(fitData,'fit','racebike','A') ).rejects.toThrow('invalid credentials')
            expect(request).not.toHaveBeenCalled()
        })

        test('4xx response code',async ()=>{
            request.mockResolvedValue({ status:403, data:{message:'forbidden'} })

            await expect( api.uploadTour(fitData,'fit','racebike','A') )
                .rejects.toThrow('HTTP 403: {"message":"forbidden"}')
        })

        test('5xx response code includes response body in error',async ()=>{
            request.mockResolvedValue({ status:500, data:{error:'Internal Server Error'} })

            await expect( api.uploadTour(fitData,'fit','racebike','A') )
                .rejects.toThrow('HTTP 500: {"error":"Internal Server Error"}')
        })

        test('komoot rejects',async ()=>{
            request.mockRejectedValue(new Error('X'))

            await expect( api.uploadTour(fitData,'fit','racebike','A') ).rejects.toThrow('X')
        })

    })
})