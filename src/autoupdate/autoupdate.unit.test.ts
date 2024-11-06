import { getBindings } from "../api/bindings"
import { IncyclistUpdatesApi } from "./api"
import {checkForAppUpdates} from './autoupdate'

describe('autoupdate',()=>{
    describe('checkForAppUpdates',()=>{

        let os, appVersion, bindings,api
        beforeEach( ()=>{
            setupMocks()
  
        })

        afterEach( ()=>{
            cleanupMocks()
        })

        const setupMocks = ()=> {
            bindings = getBindings()
            if (!bindings?.appInfo)
                bindings.appInfo = {}
            bindings.appInfo.getOS = jest.fn( () => os)
            bindings.appInfo.getAppVersion = jest.fn( () =>appVersion) 
            
            api = new IncyclistUpdatesApi()
            api.getLatestAppVersion = jest.fn().mockResolvedValue({version:'0.9.9', path:'a', url:'b', downloadUrl: 'c'})

        }

        const cleanupMocks = ()=> {
            bindings.reset()
        }

        test('update available',async ()=>{
            os = {platform:'darwin'}
            appVersion = '0.9.0'

            const res = await checkForAppUpdates()
            expect(res).toEqual({version:'0.9.9', path:'a', url:'b', downloadUrl: 'c'})

        })

        test('same version - no update available',async ()=>{
            os = {platform:'darwin'}
            appVersion = '0.9.9'

            const res = await checkForAppUpdates()
            expect(res).toBeNull()
            expect(api.getLatestAppVersion).toHaveBeenCalled()

        })

        test('newer version - no update available',async ()=>{
            os = {platform:'darwin'}
            appVersion = '1.2.0'

            const res = await checkForAppUpdates()
            expect(res).toBeNull()
            expect(api.getLatestAppVersion).toHaveBeenCalled()

        })


        test('windows should not trigger update check',async ()=>{
            os = {platform:'win32'}
            appVersion = '0.9.0'           

            const res = await checkForAppUpdates()
            expect(res).toBeNull()
            expect(api.getLatestAppVersion).not.toHaveBeenCalled()

        })

        test('getLatesVersion does not return a valid result',async ()=>{
            os = {platform:'darwin'}
            appVersion = '1.2.0'
            api.getLatestAppVersion = jest.fn().mockResolvedValue(null)

            const res = await checkForAppUpdates()
            expect(res).toBeNull()
            expect(api.getLatestAppVersion).toHaveBeenCalled()

        })


    })
})