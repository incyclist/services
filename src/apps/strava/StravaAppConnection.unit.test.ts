import { sleep } from "incyclist-devices/lib/utils/utils";
import { ISecretBinding } from "../../api/bindings/secret";
import { Inject } from "../../base/decorators";
import { Observer } from "../../base/types";
import { UserSettingsService } from "../../settings";
import { waitNextTick } from "../../utils";
import { StravaApi, StravaConfig } from "../base/api";
import { StravaAppConnection } from "./StravaAppConnection";
import { StravaCredentials } from "./types";


const UserSettingsMock = (initialized:boolean, credentials:StravaCredentials|null,uuid?:string):Partial<UserSettingsService>=>({
    isInitialized: initialized,
    get: jest.fn( (key) => key==='uuid' ? uuid??'12345678-0000-1111-2222-123456789abc' : credentials),
    set: jest.fn()
})

const ApiMock = (props:{tokenUpdate?:StravaConfig,initError?:boolean }):Partial<StravaApi> =>{
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

describe ('StravaAppConnection', ()=>{

    let service: StravaAppConnection

    const setupMocks = (mocks:MockDefinition) =>{
        Inject('UserSettings', mocks.userSettings)
        Inject('SecretBindings', mocks.bindings)
        service.getApi = jest.fn().mockReturnValue(mocks.api)
    }
    const cleanupMocks = (s) => {
        Inject('UserSettings', null)
        Inject('Api', null)               
        Inject('SecretBindings', null)
    }

    describe( 'init',()=>{
        const logSpy = jest.fn()

        beforeEach(()=>{
            service = new StravaAppConnection()
            service.on('log', logSpy);
        })

        afterEach(()=>{           
            cleanupMocks(service) 
            service.reset()
        })


        test('normal positive flow',()=>{

            
            const credentials:StravaCredentials = {accesstoken:'1',refreshtoken:'2',expiration:new Date(Date.now()+1000).toISOString()}
            
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
            const credentials:StravaCredentials = {accesstoken:'1',refreshtoken:'2',expiration:new Date(Date.now()+1000).toISOString()}

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
            const credentials:StravaCredentials = {accesstoken:'1',refreshtoken:'2',expiration:new Date(Date.now()+1000).toISOString()}
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
            const credentials:StravaCredentials = {accesstoken:'1',refreshtoken:'2',expiration:new Date(Date.now()+1000).toISOString()}
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
            service = new StravaAppConnection()

            service.on('log', logSpy);
        })

        afterEach(()=>{           
            cleanupMocks(service) 
            service.reset()
        })

        test('already connected',async ()=>{          
            const credentials:StravaCredentials = {accesstoken:'1',refreshtoken:'2',expiration:new Date(Date.now()+1000).toISOString()}
            const mocks: MockDefinition = {
                userSettings: UserSettingsMock(true, credentials,'12345678-0000-1111-2222-123456789abc'),
                bindings: SecretMock(),
                api: ApiMock({})              
            };
            setupMocks(mocks);         
            

            const success = await service.connect({accesstoken:'1', refreshtoken:'2', expiration:new Date().toISOString()});
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
        
            const success = await service.connect({accesstoken:'test', refreshtoken:'test', expiration:new Date('2024-01-01').toISOString()});
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
            service = new StravaAppConnection()
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




})