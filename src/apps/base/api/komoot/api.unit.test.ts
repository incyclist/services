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


})