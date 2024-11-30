import { format } from 'path'
import { VeloHeroApi } from '../../apps'
import { UserSettingsService } from '../../settings'
import { Activity, ActivityDetails } from '../base'
import { Credentials, VeloHeroAuth } from './types'
import { VeloHeroUpload } from './velohero'
import { error } from 'console'

const UserSettingsMock = (initialized:boolean, credentials:VeloHeroAuth|null,uuid?:string):Partial<UserSettingsService>=>({
        isInitialized: initialized,
        get: jest.fn( (key) => key==='uuid' ? uuid??'12345678-0000-1111-2222-123456789abc' : credentials),
        set: jest.fn()
})

const ApiMock = (props:{loginSuccess?:boolean, loginError?:string, uploadResponse?, uploadError?:string}):Partial<VeloHeroApi> =>{
    const result:Partial<VeloHeroApi> = {
        login:jest.fn(),
        upload:jest.fn()
    }

    if (props.loginSuccess) {
        result.login = jest.fn().mockResolvedValue(true)
    }
    if (props.loginError) {
        result.login = jest.fn().mockRejectedValue(new Error(props.loginError))
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
    userSettings?: Partial<UserSettingsService>
    decryptMock?:(auth:VeloHeroAuth)=>Credentials
}

const createCredentials = (s) =>{
    s.username = 'test'
    s.password = 'test'
    s.getUuid = ()=>'12345678-0000-1111-2222-123456789abc'

    const credentials = s.encrypt()
    
    return credentials
}

const createLegacyCredentials = (s,algo) =>{
    s.username = 'test'
    s.password = 'test'
    s.getUuid = ()=>'12345678-0000-1111-2222-123456789abc'

    const credentials = s.encryptLegacy(algo)
    
    return credentials
}


describe ('VeloHeroUpload', ()=>{

    let service: VeloHeroUpload

    const setupMocks = (mocks:MockDefinition) =>{
        service.inject('UserSettings', mocks.userSettings)
        service.inject('Api', mocks.api)        
        if (mocks.decryptMock) {
            service['decrypt'] = mocks.decryptMock
        }
            
    }
    const cleanupMocks = (s) => {
        service.inject('UserSettings', null)
        service.inject('Api', null)               
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

        test('create credentials',()=>{

        })

        test('normal positive flow',()=>{

            
            const credentials = createCredentials(service)
            
            const mocks: MockDefinition = {
              userSettings: UserSettingsMock(true, credentials,'12345678-0000-1111-2222-123456789abc'),
              //decryptMock:jest.fn( () => ({username:'test',password:'test'}))
            };
            setupMocks(mocks);         
         
            const success = service.init();
            expect(success).toBe(true)
            expect(logSpy).toHaveBeenCalledWith({message:'VeloHero init done', hasCredentials:true})
            expect(service.isConnected()).toBe(true)    

        })

        test('credentials in clear text',()=>{
            
            const mocks: MockDefinition = {
              userSettings: UserSettingsMock(true, { username: 'test', password: 'test' }),
            };
            setupMocks(mocks);         
         
            const success = service.init();
            expect(success).toBe(true)
            expect(logSpy).toHaveBeenCalledWith({message:'VeloHero init done', hasCredentials:true})
            expect(service.isConnected()).toBe(true)    

        })

        test('alread initialized',()=>{
            const userSettings = UserSettingsMock(true, { username: 'test', password: 'test' })
            setupMocks({userSettings});         
         
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
            expect(logSpy).toHaveBeenCalledWith({message:'VeloHero init done', hasCredentials:false})
            expect(service.isConnected()).toBe(false)    
        })

        test('error while decrypting credentials',()=>{
            const mocks: MockDefinition = {
                userSettings: UserSettingsMock(true, { id: '123', authKey:'abc' }),
                decryptMock:jest.fn( () => {throw new Error('test')})
              };
              setupMocks(mocks);         
           

            const success = service.init();
            expect(success).toBe(false)
            expect(logSpy).toHaveBeenCalledWith({message:'error', fn:'init',error:'test',stack:expect.anything()})
            expect(service.isConnected()).toBe(false)    
        })

        test('legacy cipher',()=>{

            
            const credentials = createLegacyCredentials(service,'aes256')
            
            const mocks: MockDefinition = {
              userSettings: UserSettingsMock(true, credentials,'12345678-0000-1111-2222-123456789abc'),
              //decryptMock:jest.fn( () => ({username:'test',password:'test'}))
            };
            setupMocks(mocks);         
         
            const success = service.init();
            expect(success).toBe(true)
            expect(logSpy).toHaveBeenCalledWith({message:'VeloHero init done', hasCredentials:true})
            expect(service.isConnected()).toBe(true)    

        })



    } )
    describe( 'login',()=>{
        const loginStartSpy = jest.fn();
        const loginSuccessSpy = jest.fn();
        const loginFailedSpy = jest.fn();
        const logSpy = jest.fn()
        

        beforeEach(()=>{
            service = new VeloHeroUpload()

            service.on('log', logSpy);
            service.on('login-start', loginStartSpy);
            service.on('login-success', loginSuccessSpy);
            service.on('login-failure', loginFailedSpy);

        })

        afterEach(()=>{           
            cleanupMocks(service) 
            service.reset()
        })

        test('login success',async ()=>{                    
            const mocks: MockDefinition = {
              userSettings: UserSettingsMock(true, null,'12345678-1111-2222-3333-123456789abc'),              
              api: ApiMock({loginSuccess:true})
            };
            setupMocks(mocks);         
         
            const success = await service.login('test','test');
            expect(success).toBe(true)

            expect(loginStartSpy).toHaveBeenCalled()
            expect(loginSuccessSpy).toHaveBeenCalled()

            expect(logSpy).toHaveBeenCalledWith({message:'VeloHero Login'})
            expect(logSpy).toHaveBeenCalledWith({message:'VeloHero Login success'})
            expect(logSpy).not.toHaveBeenCalledWith(expect.objectContaining({message:'error'}))

            expect(service.isConnecting()).toBe(false)    
            expect(mocks.userSettings?.set).toHaveBeenCalledWith('user.auth.velohero',{ id: expect.anything(), authKey: expect.anything(),version:'2' })
        })

        test('login failure',async ()=>{                    
            const mocks: MockDefinition = {
              userSettings: UserSettingsMock(true, null,'12345678-1111-2222-3333-123456789abc'),              
              api: ApiMock({loginError:'TEST'})
            };
            setupMocks(mocks);         

            let success
         
            await expect(async ()=>{ success = await service.login('test','test')}).rejects.toThrow('TEST')
            expect(success).toBe(undefined)

            expect(loginStartSpy).toHaveBeenCalled()
            expect(loginFailedSpy).toHaveBeenCalledWith('TEST')

            expect(logSpy).toHaveBeenCalledWith({message:'VeloHero Login'})
            expect(logSpy).toHaveBeenCalledWith({message:'VeloHero Login failed',error:'TEST'})

            expect(service.isConnecting()).toBe(false)    
            expect(mocks.userSettings?.set).not.toHaveBeenCalledWith('user.auth.velohero',expect.anything())
        })


    } )


    describe( 'disconnect',()=>{
        beforeEach(()=>{
            service = new VeloHeroUpload()
            service['ensureInitialized']= jest.fn( () => true)
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
            expect(mocks.userSettings?.set).toHaveBeenCalledWith('user.auth.velohero',null)
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
            const mocks: MockDefinition = {
              userSettings: UserSettingsMock(true, { username: 'test', password:'test'}),              
              api: ApiMock({uploadResponse:{id:'12345', 'show-url': 'https://app.velohero.com/workouts/show/12345'}})   
            };
            setupMocks(mocks);

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
            const mocks: MockDefinition = {
              userSettings: UserSettingsMock(true, { username: 'test', password:'test'}),              
              api: ApiMock({uploadResponse:{id:'12345'}})   
            };
            setupMocks(mocks);

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
            const mocks: MockDefinition = {
                userSettings: UserSettingsMock(true, { username: 'test', password:'test'}),              
                api: ApiMock({uploadError:'TEST'})   
              };
              setupMocks(mocks);
  
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
              expect (logSpy).not.toHaveBeenCalledWith({message:'VeloHero Upload skipped', reason:'not initialized'})
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
              expect (logSpy).toHaveBeenCalledWith({message:'VeloHero Upload skipped', reason:'not initialized'})
              expect(mocks.api?.upload).not.toHaveBeenCalled()

        })


    } )



    describe( 'getUrl',()=>{} )

})