import { Inject } from "../../base/decorators/Injection"
import { ActivityDetails } from "../base"
import { IActivityUpload } from "./types"

// The factory pulls in AppsService lazily via a @Injectable getter (see factory.ts).
// Stub the whole "../../apps" module so importing it here doesn't drag in the real
// AppsService (and, transitively, the real Strava/Intervals uploaders, which register
// themselves on this same Singleton factory as a side effect of their own module load).
jest.mock("../../apps", () => ({ useAppsService: jest.fn() }))

import { ActivityUploadFactory } from "./factory"

describe ('ActivityUploadFactory',()=>{

    class MockUploader implements IActivityUpload{
        protected connected: boolean
        constructor( uploadFn: (activity: ActivityDetails, format?: string) => Promise<boolean>, connected = true) {
            this.upload = uploadFn
            this.connected = connected
        }
        init(): boolean { throw new Error("Method not implemented.")}
        isConnected(): boolean { return this.connected}
        isConnecting(): boolean { throw new Error("Method not implemented.")}
        disconnect(): void { throw new Error("Method not implemented.") }
        upload(activity: ActivityDetails, format?: string): Promise<boolean> { throw new Error("Method not implemented.") } 
        getUrl(id: string): string {
            throw new Error("Method not implemented.")
        }
    }

    describe('add',()=>{
        let factory

        beforeEach( ()=>{
            factory = new ActivityUploadFactory()
        })
        afterEach( ()=>{
            factory.uploaders = []  
        })

        test('new',()=>{
            const u1 = new MockUploader(jest.fn().mockResolvedValue(true))
            const u2 = new MockUploader(jest.fn().mockResolvedValue(true))
            factory.add('s1', u1)
            factory.add('s2', u2)

            expect(factory.uploaders).toEqual([
                { service:'s1', uploader:u1},
                { service:'s2', uploader:u2}   
            ])
            
        })
        test('same service will overwrite',()=>{
            const u1 = new MockUploader(jest.fn().mockResolvedValue(true))
            const u2 = new MockUploader(jest.fn().mockResolvedValue(true))
            factory.add('s1', u1)
            factory.add('s1', u2)

            expect(factory.uploaders).toEqual([
                { service:'s1', uploader:u2}   
            ])
            
        })
        
    })

    describe('upload',()=>{
        let factory
        let appsService
        beforeEach( ()=>{
            factory = new ActivityUploadFactory()
            appsService = { isEnabled: jest.fn().mockReturnValue(true) }
            Inject('AppsService', appsService)
        })
        afterEach( ()=>{
            factory.uploaders = []
            Inject('AppsService', null)
        })

        test('success',async ()=>{
            const u1 = new MockUploader(jest.fn().mockResolvedValue(true))
            const u2 = new MockUploader(jest.fn().mockResolvedValue(true))
            factory.add('s1', u1)
            factory.add('s2', u2)

            const res = await factory.upload()
            expect(u1.upload).toHaveBeenCalled()
            expect(u2.upload).toHaveBeenCalled()    
            expect(res).toEqual( [
                { service:'s1', success:true},
                { service:'s2', success:true},
            ])

        })
        test('partial success',async ()=>{
            const u1 = new MockUploader(jest.fn().mockResolvedValue(true))
            const u2 = new MockUploader(jest.fn().mockRejectedValue(new Error('some error')))
            factory.add('s1', u1)
            factory.add('s2', u2)

            const res = await factory.upload()
            expect(u1.upload).toHaveBeenCalled()
            expect(u2.upload).toHaveBeenCalled()    
            expect(res).toEqual( [
                { service:'s1', success:true},
                { service:'s2', success:false, error:'some error'},
            ])
            
        })
        test('no uploaders defined',async ()=>{
            const res = await factory.upload()
            expect(res).toEqual([])
            
        })
        test('nothing to do',async ()=>{
            const u1 = new MockUploader(jest.fn().mockResolvedValue(true),false)
            const u2 = new MockUploader(jest.fn().mockRejectedValue(new Error('some error')),false)
            factory.add('s1', u1)
            factory.add('s2', u2)

            const res = await factory.upload()
            expect(u1.upload).not.toHaveBeenCalled()
            expect(u2.upload).not.toHaveBeenCalled()
            expect(res).toEqual([])


        })

        test('connected but disabled',async ()=>{
            const u1 = new MockUploader(jest.fn().mockResolvedValue(true))
            factory.add('s1', u1)
            appsService.isEnabled.mockReturnValue(false)

            const res = await factory.upload()
            expect(u1.upload).not.toHaveBeenCalled()
            expect(res).toEqual([])
        })

        test('one enabled, one disabled',async ()=>{
            const u1 = new MockUploader(jest.fn().mockResolvedValue(true))
            const u2 = new MockUploader(jest.fn().mockResolvedValue(true))
            factory.add('strava', u1)
            factory.add('intervals', u2)
            appsService.isEnabled.mockImplementation( (service)=> service==='strava')

            const res = await factory.upload()
            expect(u1.upload).toHaveBeenCalled()
            expect(u2.upload).not.toHaveBeenCalled()
            expect(res).toEqual([
                { service:'strava', success:true},
            ])
        })
    })

    describe('isUploadEnabled',()=>{
        let factory
        let appsService
        beforeEach( ()=>{
            factory = new ActivityUploadFactory()
            appsService = { isEnabled: jest.fn().mockReturnValue(true) }
            Inject('AppsService', appsService)
        })
        afterEach( ()=>{
            factory.uploaders = []
            Inject('AppsService', null)
        })

        test('service unknown',()=>{
            expect(factory.isUploadEnabled('s1')).toBe(false)
            expect(appsService.isEnabled).not.toHaveBeenCalled()
        })

        test('connected and enabled',()=>{
            const u1 = new MockUploader(jest.fn().mockResolvedValue(true))
            factory.add('s1', u1)

            expect(factory.isUploadEnabled('s1')).toBe(true)
            expect(appsService.isEnabled).toHaveBeenCalledWith('s1','ActivityUpload')
        })

        test('connected but disabled',()=>{
            const u1 = new MockUploader(jest.fn().mockResolvedValue(true))
            factory.add('s1', u1)
            appsService.isEnabled.mockReturnValue(false)

            expect(factory.isUploadEnabled('s1')).toBe(false)
        })

        test('not connected',()=>{
            const u1 = new MockUploader(jest.fn().mockResolvedValue(true), false)
            factory.add('s1', u1)

            expect(factory.isUploadEnabled('s1')).toBe(false)
            expect(appsService.isEnabled).not.toHaveBeenCalled()
        })
    })
})