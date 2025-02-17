import { VeloHeroApi, VeloHeroAppConnection } from '../../apps'
import { Inject } from '../../base/decorators'
import { ActivityDetails } from '../base'
import { VeloHeroUpload } from './velohero'


const AppConnectionMock = (initialized:boolean, connected:boolean, api):Partial<VeloHeroAppConnection> => ({
    init: jest.fn().mockReturnValue(initialized),
    isConnected: jest.fn().mockReturnValue(connected),
    getApi: jest.fn().mockReturnValue(api),
    getCredentials: jest.fn().mockReturnValue({username:'foo', password:'bar'})
})


const ApiMock = (props:{loginSuccess?:boolean, loginError?:string, uploadResponse?, uploadError?:string}):Partial<VeloHeroApi> =>{
    const result:Partial<VeloHeroApi> = {
        login:jest.fn(),
        upload:jest.fn()
    }

    if (props.uploadResponse) {
        result.upload = jest.fn().mockResolvedValue(props.uploadResponse)
    }
    if (props.uploadError) {
        result.upload = jest.fn().mockRejectedValue(new Error(props.uploadError))
    }
    return result
   
}

type MockDefinition = {
    api?: Partial<VeloHeroApi>,
    connection?: Partial<VeloHeroAppConnection>
    initialized?:boolean, 
    connected?:boolean

}

describe ('VeloHeroUpload', ()=>{

    let service: VeloHeroUpload

    const setupMocks = (mocks:MockDefinition) =>{
        if ( !mocks.connection) {
            mocks.connection = AppConnectionMock( mocks.initialized??false, mocks.connected??false, mocks.api)
        }
        Inject('VeloHeroAppConnection',mocks.connection)
           
    }
    const cleanupMocks = (s) => {
        Inject('VeloHeroAppConnection',null)
    }

    describe( 'init',()=>{
        const logSpy = jest.fn()

        beforeEach(()=>{
            service = new VeloHeroUpload()
            service.on('log', logSpy);
        })

        afterEach(()=>{           
            cleanupMocks(service) 
            service.reset()
        })


        test('normal positive flow',()=>{
           
            setupMocks({initialized:true,connected:true,api: ApiMock({}) });         
         
            const success = service.init();
            expect(success).toBe(true)
            expect(service.isConnected()).toBe(true)    
        })

        test('not connected',()=>{
           
            setupMocks({initialized:true,connected:false,api: ApiMock({}) });         
         
            const success = service.init();
            expect(success).toBe(true)
            expect(service.isConnected()).toBe(false)    
        })

        
        test('userSettings not yet initialized',()=>{
            setupMocks({initialized:false,api: ApiMock({}) });         
                   
         

            const success = service.init();
            expect(success).toBe(false)
            expect(logSpy).not.toHaveBeenCalled()
            expect(service.isConnected()).toBe(false)    
        })


    } )

    
    describe( 'upload',()=>{

        const logSpy = jest.fn()
        
        beforeEach(()=>{
            service = new VeloHeroUpload()

            service.on('log', logSpy);
        })

        afterEach(()=>{           
            cleanupMocks(service) 
            service.reset()
        })

        test('succesfull tcx upload',async ()=>{

            const api = ApiMock({uploadResponse:{id:'12345', 'show-url': 'https://app.velohero.com/workouts/show/12345'}})
            setupMocks({initialized:true,connected:true,api });         


            const activity:Partial<ActivityDetails>  = {
                tcxFileName:'test.tcx',
            }
    

            const success =     await service.upload(activity as ActivityDetails)
            expect(success).toBe(true)
            expect(activity.links).toMatchObject({
                'velohero': {
                    activity_id: '12345',
                    url: 'https://app.velohero.com/workouts/show/12345'
                }
            })
            expect (logSpy).toHaveBeenCalledWith({message:'VeloHero Upload',format:'TCX'})
            expect (logSpy).toHaveBeenCalledWith(expect.objectContaining({message:'VeloHero Upload success' }))

        })

        test('succesfull fit upload',async ()=>{
            const api = ApiMock({uploadResponse:{id:'12345', 'show-url': 'https://app.velohero.com/workouts/show/12345'}})
            setupMocks({initialized:true,connected:true,api });         

            const activity:Partial<ActivityDetails>  = {
                fitFileName:'test.fit',
            }
    

            const success =     await service.upload(activity as ActivityDetails,'fit')
            expect(success).toBe(true)
            expect(activity.links).toMatchObject({
                'velohero': {
                    activity_id: '12345',
                    url: 'https://app.velohero.com/workouts/show/12345'
                }
            })
            expect (logSpy).toHaveBeenCalledWith({message:'VeloHero Upload',format:'FIT'})
            expect (logSpy).toHaveBeenCalledWith(expect.objectContaining({message:'VeloHero Upload success' }))

        })

        test('upload failed',async ()=>{
            const api = ApiMock({uploadError:'TEST'})
            setupMocks({initialized:true,connected:true,api });         
  
            const activity:Partial<ActivityDetails>  = {
                  tcxFileName:'test.tcx',
            }
      
  
            const success =     await service.upload(activity as ActivityDetails,'tcx')
            expect(success).toBe(false)
            expect(activity.links).toMatchObject({
                'velohero': {
                    error:'TEST'
                }
            })
            expect (logSpy).toHaveBeenCalledWith({message:'VeloHero Upload',format:'TCX'})
            expect (logSpy).toHaveBeenCalledWith(expect.objectContaining({message:'VeloHero Upload failure', error:'TEST' }))
  
        })

        test('not connected',async ()=>{
            const api = ApiMock({uploadError:'TEST'})
            setupMocks({initialized:true,connected:false,api });         
  
            const activity:Partial<ActivityDetails>  = {
                tcxFileName:'test.tcx',
            }
    

            const success =     await service.upload(activity as ActivityDetails,'tcx')
            expect(success).toBe(false)
            expect(activity.links).toBeUndefined()
            expect (logSpy).not.toHaveBeenCalledWith({message:'VeloHero Upload skipped', reason:'not initialized'})
            expect(api?.upload).not.toHaveBeenCalled()

        })

        test('not initialized',async ()=>{
            const api = ApiMock({uploadError:'TEST'})
            setupMocks({initialized:false,connected:false,api });         
  
              const activity:Partial<ActivityDetails>  = {
                  tcxFileName:'test.tcx',
              }
      
  
              const success =     await service.upload(activity as ActivityDetails,'tcx')
              expect(success).toBe(false)
              expect(activity.links).toBeUndefined()
              expect (logSpy).toHaveBeenCalledWith({message:'VeloHero Upload skipped', reason:'not initialized'})
              expect(api?.upload).not.toHaveBeenCalled()

        })


    } )



    describe( 'getUrl',()=>{} )

})