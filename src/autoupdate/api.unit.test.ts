import { IncyclistUpdatesApi } from "./api"
import fs from 'fs'

describe( 'IncyclistUpdatesApi',()=>{

    describe('getLatestAppVersion',()=>{

        let api:IncyclistUpdatesApi, a
        let mockServerResult, mockServerError

        beforeEach( ()=>{
            
            a = api = new IncyclistUpdatesApi()
            a._get = jest.fn( async ()=> {
                if (mockServerError) throw mockServerError
                return {data:mockServerResult}
            })
            a.getBaseUrl = jest.fn().mockReturnValue('https://incyclist.com')
        })

        afterEach( ()=> {
            a.reset()
            mockServerError  = undefined
            mockServerResult = undefined
        })



        test('mac - valid response',async ()=>{
            mockServerResult = {version:'1.0.0', path:'incyclist.dmg'}

            const res = await api.getLatestAppVersion('darwin')
            expect(res).toMatchObject({
                version:'1.0.0', 
                path:'incyclist.dmg',
                downloadUrl: 'https://incyclist.com/download/app/latest/mac/incyclist.dmg',
                url: 'https://incyclist.com'
            })
        })
        test('mac - error response',async ()=>{
            mockServerError = new Error('some error')

            const res = await api.getLatestAppVersion('darwin')
            expect(res).toBeUndefined()
        })


        test('linux - valid response',async ()=>{
            
            mockServerResult = fs.readFileSync('./__tests__/data/autoupdate/latest-linux.yml',{ encoding: 'utf8', flag: 'r' })

            const res = await api.getLatestAppVersion('linux')

            expect(res).toMatchObject({
                version:'0.9.9', 
                path:'Incyclist-0.9.9.AppImage',
                downloadUrl: 'https://incyclist.com/download/app/latest/linux/x64/Incyclist-0.9.9.AppImage',
                url: 'https://incyclist.com'
            })
        })
        test('linux - error response',async ()=>{
            mockServerError = new Error('some error')

            const res = await api.getLatestAppVersion('linux')
            expect(res).toBeUndefined()
        })

        test('windows - valid response',async ()=>{
            
            mockServerResult = fs.readFileSync('./__tests__/data/autoupdate/RELEASES',{ encoding: 'utf8', flag: 'r' })

            const res = await api.getLatestAppVersion('win32')
            expect(res).toMatchObject({
                version:'0.9.9', 
                path:'incyclist-0.9.9-setup.exe',
                downloadUrl: 'https://incyclist.com/download/app/latest/win64/incyclist-0.9.9-setup.exe',
                url: 'https://incyclist.com'
            })
        })
        test('windows - error response',async ()=>{
            mockServerError = new Error('some error')

            const res = await api.getLatestAppVersion('win32')
            expect(res).toBeUndefined()
        })


        test('unknown platform',async ()=>{

            mockServerResult = {version:'1.0.0', path:'incyclist.dmg'}
            const res = await api.getLatestAppVersion('some other platform')

            expect(res).toBeUndefined()
        })

        describe('timeout handling',()=>{

            test.each([
                ['mac','darwin'],
                ['linux','linux'],
                ['windows','win32'],
            ])('%s - timeout error is not logged as error',async (_name,platform)=>{
                mockServerError = Object.assign( new Error('timeout of 5000ms exceeded'), {code:'ECONNABORTED'})
                const logErrorSpy = jest.spyOn(a,'logError')

                const res = await api.getLatestAppVersion(platform)

                expect(res).toBeUndefined()
                expect(logErrorSpy).not.toHaveBeenCalled()
            })

            test('a real error is still logged',async ()=>{
                mockServerError = new Error('some error')
                const logErrorSpy = jest.spyOn(a,'logError')

                await api.getLatestAppVersion('darwin')

                expect(logErrorSpy).toHaveBeenCalled()
            })

            test('Network Error is still filtered (existing behaviour)',async ()=>{
                mockServerError = new Error('Network Error')
                const logErrorSpy = jest.spyOn(a,'logError')

                await api.getLatestAppVersion('darwin')

                expect(logErrorSpy).not.toHaveBeenCalled()
            })

        })

    } )

    describe('_get',()=>{

        let api:IncyclistUpdatesApi, a

        beforeEach( ()=>{
            a = api = new IncyclistUpdatesApi()
            a.getBaseUrl = jest.fn().mockReturnValue('https://updates.incyclist.com')
        })

        afterEach( ()=> {
            a.reset()
        })

        test('issues the request with an explicit timeout',async ()=>{
            const get = jest.fn().mockResolvedValue({data:{}})
            a.getApi = jest.fn().mockReturnValue({get})

            await a._get('/some/path')

            expect(get).toHaveBeenCalledWith(
                'https://updates.incyclist.com/some/path',
                expect.objectContaining({timeout: expect.any(Number)})
            )
            const [,config] = get.mock.calls[0]
            expect(config.timeout).toBeGreaterThan(0)
        })

        test('caller-supplied config is preserved and can override the timeout',async ()=>{
            const get = jest.fn().mockResolvedValue({data:{}})
            a.getApi = jest.fn().mockReturnValue({get})

            await a._get('/some/path', {timeout: 123, responseType:'text'})

            expect(get).toHaveBeenCalledWith(
                'https://updates.incyclist.com/some/path',
                expect.objectContaining({timeout: 123, responseType:'text'})
            )
        })

    })
})
