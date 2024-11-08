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



    } )
})