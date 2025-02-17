import { sleep } from 'incyclist-devices/lib/utils/utils'
import { IncyclistBindings } from '../../api'
import { ISecretBinding } from '../../api/bindings/secret'
import { DuplicateError, StravaApi, StravaAppConnection, StravaConfig } from '../../apps'
import { Inject } from '../../base/decorators/Injection'
import { Observer } from '../../base/types'
import { UserSettingsService } from '../../settings'
import { waitNextTick } from '../../utils'
import { ActivityDetails } from '../base'
import { StravaUpload } from './strava'
import { Credentials, StravaAuth } from './types'

const ApiMock = (props:{tokenUpdate?:StravaConfig,initError?:boolean, uploadResponse?, uploadError?:string,uploadDuplicateError?:DuplicateError}):Partial<StravaApi> =>{

    let observer = new Observer()
    const result:Partial<StravaApi> = {
        init:jest.fn().mockReturnValue( observer),
        update:jest.fn(),
        upload:jest.fn(),
        isAuthenticated:jest.fn()
    }

    if (props.tokenUpdate) {
        result.init = jest.fn( () =>{
            waitNextTick().then( ()=> observer.emit('token.updated', props.tokenUpdate))
            return observer
        })
    }
    if (props.initError) {
        result.init = jest.fn(()=>{ throw new Error('ERROR')})
    }

    if (props.uploadResponse) {
        result.upload = jest.fn().mockResolvedValue(props.uploadResponse)
    }
    if (props.uploadError) {
        result.upload = jest.fn().mockRejectedValue(new Error(props.uploadError))
    }
    if (props.uploadDuplicateError) {
        result.upload = jest.fn().mockRejectedValue(props.uploadDuplicateError)
    }


    return result
    
}

const AppConnectionMock = (initialized:boolean, connected:boolean, api):Partial<StravaAppConnection> => ({
    init: jest.fn().mockReturnValue(initialized),
    isConnected: jest.fn().mockReturnValue(connected),
    getApi: jest.fn().mockReturnValue(api)
})



type MockDefinition = {
    api?: Partial<StravaApi>,
    connection?: Partial<StravaAppConnection>
    initialized?:boolean, 
    connected?:boolean
}

describe ('StravaUpload', ()=>{

    let service: StravaUpload

    const setupMocks = (mocks:MockDefinition) =>{
        if ( !mocks.connection) {
            mocks.connection = AppConnectionMock( mocks.initialized??false, mocks.connected??false, mocks.api)
        }
        Inject('StravaAppConnection',mocks.connection)
    }
    const cleanupMocks = (s) => {
        Inject('StravaAppConnection',null)
    }

    describe( 'init',()=>{
        const logSpy = jest.fn()

        beforeEach(()=>{
            service = new StravaUpload()
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
            service = new StravaUpload()

            service.on('log', logSpy);
        })

        afterEach(()=>{           
            cleanupMocks(service) 
            service.reset()
        })

        test('succesfull tcx upload',async ()=>{

            const api = ApiMock({uploadResponse:{stravaId:'12345',externalId:'incyclist-id'}})
            setupMocks({initialized:true,connected:true,api });         

            const activity:Partial<ActivityDetails>  = {
                tcxFileName:'test.tcx',
                title:'test',
            }
    

            const success =     await service.upload(activity as ActivityDetails)
            expect(success).toBe(true)
            expect(activity.links).toMatchObject({
                'strava': {
                    activity_id: '12345',
                    url: 'https://www.strava.com/activities/12345'
                }
            })
            expect (logSpy).toHaveBeenCalledWith({message:'Strava Upload',format:'TCX'})
            expect (logSpy).toHaveBeenCalledWith(expect.objectContaining({message:'Strava Upload success' }))

            expect(api.upload).toHaveBeenCalledWith('test.tcx',{name: 'test', description: '', format: 'tcx'})

        })

        
        test('succesfull fit upload',async ()=>{
            const api = ApiMock({uploadResponse:{stravaId:'12345',externalId:'incyclist-id'}})
            setupMocks({initialized:true,connected:true,api });         

            const activity:Partial<ActivityDetails>  = {
                fitFileName:'test.fit',
                title:'test',
            }
    

            const success =     await service.upload(activity as ActivityDetails,'fit')
            expect(success).toBe(true)
            expect(activity.links).toMatchObject({
                'strava': {
                    activity_id: '12345',
                    url: 'https://www.strava.com/activities/12345'
                }
            })
            expect (logSpy).toHaveBeenCalledWith({message:'Strava Upload',format:'FIT'})
            expect (logSpy).toHaveBeenCalledWith(expect.objectContaining({message:'Strava Upload success' }))
            expect(api.upload).toHaveBeenCalledWith('test.fit',{name: 'test', description: '', format: 'fit'})

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
                'strava': {
                    error:'TEST'
                }
            })
            expect (logSpy).toHaveBeenCalledWith({message:'Strava Upload',format:'TCX'})
            expect (logSpy).toHaveBeenCalledWith(expect.objectContaining({message:'Strava Upload failure', error:'TEST' }))
  
        })

        test('activity already uploaded',async ()=>{
            const duplicateError = new DuplicateError('12345')
            const api = ApiMock({uploadDuplicateError:duplicateError})
            setupMocks({initialized:true,connected:true,api });         
            
  
            const activity:Partial<ActivityDetails>  = {
                tcxFileName:'test.tcx',
            }
    

            const success =     await service.upload(activity as ActivityDetails,'tcx')
            expect(success).toBe(false)
            expect(activity.links).toMatchObject({
                'strava': {
                    activity_id: '12345',
                    url: 'https://www.strava.com/activities/12345'
                }
            })
            expect (logSpy).toHaveBeenCalledWith({message:'Strava Upload',format:'TCX'})
            expect (logSpy).toHaveBeenCalledWith(expect.objectContaining({message:'Strava Upload failure', error:'duplicate',activityId:'12345' }))
  
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
              expect (logSpy).not.toHaveBeenCalledWith({message:'Strava Upload skipped', reason:'not initialized'})
              expect(api.upload).not.toHaveBeenCalled()

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
              expect (logSpy).toHaveBeenCalledWith({message:'Strava Upload skipped', reason:'not initialized'})
              expect(api.upload).not.toHaveBeenCalled()

        })


    } )



})