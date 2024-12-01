import { sleep } from 'incyclist-devices/lib/utils/utils'
import { IncyclistBindings } from '../../api'
import { ISecretBinding } from '../../api/bindings/secret'
import { DuplicateError, StravaApi, StravaConfig } from '../../apps'
import { Inject } from '../../base/decorators/Injection'
import { Observer } from '../../base/types'
import { UserSettingsService } from '../../settings'
import { waitNextTick } from '../../utils'
import { ActivityDetails } from '../base'
import { StravaUpload } from './strava'
import { Credentials, StravaAuth } from './types'

const UserSettingsMock = (initialized:boolean, credentials:StravaAuth|null,uuid?:string):Partial<UserSettingsService>=>({
        isInitialized: initialized,
        get: jest.fn( (key) => key==='uuid' ? uuid??'12345678-0000-1111-2222-123456789abc' : credentials),
        set: jest.fn()
})

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

const SecretMock = ():Partial<ISecretBinding> => ({    
    getSecret:jest.fn( (key) => 'very secret')     
})



type MockDefinition = {
    api?: Partial<StravaApi>,
    userSettings?: Partial<UserSettingsService>,
    bindings?: Partial<ISecretBinding>,    
}

describe ('StravaUpload', ()=>{

    let service: StravaUpload

    const setupMocks = (mocks:MockDefinition) =>{
        Inject('UserSettings', mocks.userSettings)
        Inject('Api', mocks.api)        
        Inject('SecretBindings', mocks.bindings)
            
            
    }
    const cleanupMocks = (s) => {
        Inject('UserSettings', null)
        Inject('Api', null)               
        Inject('SecretBindings', null)

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

            
            const credentials:StravaAuth = {accesstoken:'1',refreshtoken:'2',expiration:new Date(Date.now()+1000).toISOString()}
            
            const mocks: MockDefinition = {
              userSettings: UserSettingsMock(true, credentials,'12345678-0000-1111-2222-123456789abc'),
              bindings: SecretMock(),
              api: ApiMock({})              
            };
            setupMocks(mocks);         
         
            const success = service.init();
            expect(success).toBe(true)
            expect(logSpy).toHaveBeenCalledWith({message:'Strava init done', hasCredentials:true})
            expect(service.isConnected()).toBe(true)    
            expect(service.isConnecting()).toBe(false)

        })


        test('alread initialized',()=>{
            const credentials:StravaAuth = {accesstoken:'1',refreshtoken:'2',expiration:new Date(Date.now()+1000).toISOString()}

            const userSettings = UserSettingsMock(true, credentials)
            setupMocks({userSettings,bindings: SecretMock(),api: ApiMock({}) });         
         
            service.init();
            jest.resetAllMocks()

            const success = service.init();
            expect(success).toBe(true)
            expect(userSettings.get).not.toHaveBeenCalled()
            expect(logSpy).not.toHaveBeenCalled()
            expect(service.isConnected()).toBe(true)    
        })

        test('userSettings not yet initialized',()=>{
            const userSettings = UserSettingsMock(false, null)
            setupMocks({userSettings});         
         

            const success = service.init();
            expect(success).toBe(false)
            expect(logSpy).not.toHaveBeenCalled()
            expect(service.isConnected()).toBe(false)    
        })

        test('service not yet configured in user settings',()=>{
            const userSettings = UserSettingsMock(true, null)
            setupMocks({userSettings});         
         

            const success = service.init();
            expect(success).toBe(true)
            expect(logSpy).toHaveBeenCalledWith({message:'Strava init done', hasCredentials:false})
            expect(service.isConnected()).toBe(false)    
        })

        test('token expired',async ()=>{ 
            const credentials:StravaAuth = {accesstoken:'1',refreshtoken:'2',expiration:new Date(Date.now()+1000).toISOString()}
            const refresh:StravaConfig = {accessToken:'1',refreshToken:'3',expiration:new Date('2024-01-01T00:00:00Z'),clientId:'1',clientSecret:'2'}
            const mocks: MockDefinition = {
              userSettings: UserSettingsMock(true, credentials,'12345678-0000-1111-2222-123456789abc'),
              bindings: SecretMock(),
              api: ApiMock({tokenUpdate:refresh})              
            };
            setupMocks(mocks);         

            const success = service.init();
            await waitNextTick()

            expect(success).toBe(true)
            expect(logSpy).toHaveBeenCalledWith({message:'Strava init done', hasCredentials:true})
            expect(service.isConnected()).toBe(true)    
            expect(logSpy).toHaveBeenCalledWith({message:'Strava Save Credentials'})
            expect(mocks.userSettings?.set).toHaveBeenCalledWith('user.auth.strava',{
                accesstoken: refresh.accessToken,
                refreshtoken: refresh.refreshToken,
                expiration: refresh.expiration?.toISOString()
            })

        })

        test('error in Api.init',async ()=>{ 
            const credentials:StravaAuth = {accesstoken:'1',refreshtoken:'2',expiration:new Date(Date.now()+1000).toISOString()}
            const refresh:StravaConfig = {accessToken:'1',refreshToken:'3',expiration:new Date('2024-01-01T00:00:00Z'),clientId:'1',clientSecret:'2'}
            const mocks: MockDefinition = {
              userSettings: UserSettingsMock(true, credentials,'12345678-0000-1111-2222-123456789abc'),
              bindings: SecretMock(),
              api: ApiMock({initError:true})              
            };
            setupMocks(mocks);         

            const success = service.init();

            await sleep(100 )
            expect(success).toBe(false)
            expect(service.isConnected()).toBe(false)

        })
            



    } )


    describe( 'connect',()=>{
        const logSpy = jest.fn()
       

        beforeEach(()=>{
            service = new StravaUpload()

            service.on('log', logSpy);
        })

        afterEach(()=>{           
            cleanupMocks(service) 
            service.reset()
        })

        test('already connected',async ()=>{          
            const credentials:StravaAuth = {accesstoken:'1',refreshtoken:'2',expiration:new Date(Date.now()+1000).toISOString()}
            const mocks: MockDefinition = {
                userSettings: UserSettingsMock(true, credentials,'12345678-0000-1111-2222-123456789abc'),
                bindings: SecretMock(),
                api: ApiMock({})              
            };
            setupMocks(mocks);         
            

            const success = await service.connect('1','2',new Date());
            expect(success).toBe(true)


            expect(logSpy).toHaveBeenCalledWith({message:'Connect with Strava'})
            expect(logSpy).toHaveBeenCalledWith({message:'Connect with Strava success'})
            expect(logSpy).not.toHaveBeenCalledWith(expect.objectContaining({message:'error'}))

            expect(service.isConnecting()).toBe(false)    
            expect(mocks.userSettings?.set).not.toHaveBeenCalledWith('user.auth.strava',expect.anything)
        })

        test('new connection',async ()=>{                    
            const mocks: MockDefinition = {
                userSettings: UserSettingsMock(true, null,'12345678-0000-1111-2222-123456789abc'),
                bindings: SecretMock(),
                api: ApiMock({})                            
            };
            setupMocks(mocks);         
         
            const success = await service.connect('test','test',new Date('2024-01-01'))
            expect(success).toBe(true)

            expect(logSpy).toHaveBeenCalledWith({message:'Connect with Strava'})
            expect(logSpy).toHaveBeenCalledWith({message:'Connect with Strava success'})

            expect(service.isConnecting()).toBe(false)    
            expect(mocks.userSettings?.set).toHaveBeenCalledWith('user.auth.strava',{
                accesstoken: 'test',
                refreshtoken: 'test',
                expiration: '2024-01-01T00:00:00.000Z'
            })
        })


    } )



    describe( 'disconnect',()=>{
        beforeEach(()=>{
            service = new StravaUpload()
        })

        afterEach(()=>{           
            cleanupMocks(service) 
            service.reset()
        })

        test('perform disconnect',()=>{                    
            const mocks: MockDefinition = {
              userSettings: UserSettingsMock(true, null),                            
            };
            setupMocks(mocks);         

            service.disconnect();            
            expect(service.isConnected()).toBe(false)
            expect(mocks.userSettings?.set).toHaveBeenCalledWith('user.auth.strava',null)
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
            const credentials:StravaAuth = {accesstoken:'1',refreshtoken:'2',expiration:new Date(Date.now()+1000).toISOString()}
            
            const mocks: MockDefinition = {
              userSettings: UserSettingsMock(true, credentials,'12345678-0000-1111-2222-123456789abc'),
              bindings: SecretMock(),
              api: ApiMock({uploadResponse:{stravaId:'12345',externalId:'incyclist-id'}})              
            };
            setupMocks(mocks);

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

            expect(mocks.api?.upload).toHaveBeenCalledWith('test.tcx',{name: 'test', description: '', format: 'tcx'})

        })

        test('succesfull fit upload',async ()=>{
            const credentials:StravaAuth = {accesstoken:'1',refreshtoken:'2',expiration:new Date(Date.now()+1000).toISOString()}
            
            const mocks: MockDefinition = {
              userSettings: UserSettingsMock(true, credentials,'12345678-0000-1111-2222-123456789abc'),
              bindings: SecretMock(),
              api: ApiMock({uploadResponse:{stravaId:'12345',externalId:'incyclist-id'}})              
            };
            setupMocks(mocks);

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
            expect(mocks.api?.upload).toHaveBeenCalledWith('test.fit',{name: 'test', description: '', format: 'fit'})

        })

        test('upload failed',async ()=>{
            const credentials:StravaAuth = {accesstoken:'1',refreshtoken:'2',expiration:new Date(Date.now()+1000).toISOString()}
            
            const mocks: MockDefinition = {
              userSettings: UserSettingsMock(true, credentials,'12345678-0000-1111-2222-123456789abc'),
              bindings: SecretMock(),
              api: ApiMock({uploadError:'TEST'})   
            };

            setupMocks(mocks);
  
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
            const credentials:StravaAuth = {accesstoken:'1',refreshtoken:'2',expiration:new Date(Date.now()+1000).toISOString()}
            const duplicateError = new DuplicateError('12345')
            const mocks: MockDefinition = {
              userSettings: UserSettingsMock(true, credentials,'12345678-0000-1111-2222-123456789abc'),
              bindings: SecretMock(),
              api: ApiMock({uploadDuplicateError:duplicateError})   
            };

            setupMocks(mocks);
  
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
            const mocks: MockDefinition = {
                userSettings: UserSettingsMock(true, null),              
                api: ApiMock({uploadError:'TEST'})   
              };
              setupMocks(mocks);
  
              const activity:Partial<ActivityDetails>  = {
                  tcxFileName:'test.tcx',
              }
      
  
              const success =     await service.upload(activity as ActivityDetails,'tcx')
              expect(success).toBe(false)
              expect(activity.links).toBeUndefined()
              expect (logSpy).not.toHaveBeenCalledWith({message:'Strava Upload skipped', reason:'not initialized'})
              expect(mocks.api?.upload).not.toHaveBeenCalled()

        })

        test('not initialized',async ()=>{
            const mocks: MockDefinition = {
                userSettings: UserSettingsMock(false, null),              
                api: ApiMock({uploadError:'TEST'})   
              };
              setupMocks(mocks);
  
              const activity:Partial<ActivityDetails>  = {
                  tcxFileName:'test.tcx',
              }
      
  
              const success =     await service.upload(activity as ActivityDetails,'tcx')
              expect(success).toBe(false)
              expect(activity.links).toBeUndefined()
              expect (logSpy).toHaveBeenCalledWith({message:'Strava Upload skipped', reason:'not initialized'})
              expect(mocks.api?.upload).not.toHaveBeenCalled()

        })


    } )



})