import { ActivityDetails } from "../base"
import { ActivityUploadFactory } from "./factory"
import { IActivityUpload } from "./types"

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
        beforeEach( ()=>{
            factory = new ActivityUploadFactory()
        })
        afterEach( ()=>{
            factory.uploaders = []  
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
    })
})