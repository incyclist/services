import { sleep } from "incyclist-devices/lib/utils/utils";
import { ISecretBinding } from "../../api/bindings/secret";
import { Inject } from "../../base/decorators";
import { Observer } from "../../base/types";
import { UserSettingsService } from "../../settings";
import { waitNextTick } from "../../utils";
import { VeloHeroApi } from "../base/api";
import { VeloHeroAppConnection } from "./VeloHeroAppConnection";
import { VeloHeroAuth, VeloHeroCredentials } from "./types";


const UserSettingsMock = (initialized:boolean, credentials:VeloHeroAuth|null,uuid?:string):Partial<UserSettingsService>=>({
    isInitialized: initialized,
    get: jest.fn( (key) => { 
        const result = key==='uuid' ? uuid??'12345678-0000-1111-2222-123456789abc' : credentials 
        return result
    }),
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

const createCredentials = (s,credentials) =>{
    s.credentials = credentials   
    s.getUuid = ()=>'12345678-0000-1111-2222-123456789abc'

    const auth = s.encrypt('aes256')
    
    return auth
}


type MockDefinition = {
    api?: Partial<VeloHeroApi>,
    userSettings?: Partial<UserSettingsService>,
    decryptMock?:(algo:string,auth:VeloHeroAuth)=>VeloHeroCredentials
}

describe ('VeloHeroAppConnection', ()=>{

    let service: VeloHeroAppConnection

    const setupMocks = (mocks:MockDefinition) =>{
        service.inject('UserSettings', mocks.userSettings)
        service.getApi = jest.fn().mockReturnValue(mocks.api)
        if (mocks.decryptMock) {
            service['decrypt'] = mocks.decryptMock
        }
    }
    const cleanupMocks = (s) => {
        Inject('UserSettings', null)
        Inject('Api', null)               
        jest.clearAllMocks()
    }

    describe( 'init',()=>{
        const logSpy = jest.fn()

        beforeEach(()=>{
            service = new VeloHeroAppConnection()
            service.on('log', logSpy);
        })

        afterEach(()=>{           
            cleanupMocks(service) 
            service.reset()
        })


        test('normal positive flow',()=>{
            const credentials:VeloHeroAuth = createCredentials(service,{username:'foo',password:'bar'})
            
            const mocks: MockDefinition = {
                userSettings: UserSettingsMock(true, credentials,'12345678-0000-1111-2222-123456789abc'),
                api: ApiMock({})              
            };
            setupMocks(mocks);         
        
            const success = service.init();
            expect(success).toBe(true)
            expect(logSpy).toHaveBeenCalledWith({message:'VeloHero init done', hasCredentials:true})
            expect(service.isConnected()).toBe(true)    
            expect(service.isConnecting()).toBe(false)
            expect(service.getCredentials()).toEqual({username:'foo',password:'bar'})

        })


        test('alread initialized',()=>{
            const credentials:VeloHeroAuth = createCredentials(service,{username:'foo',password:'bar'})
            const userSettings = UserSettingsMock(true, credentials,'12345678-0000-1111-2222-123456789abc')
            const mocks: MockDefinition = {
                userSettings ,
                api: ApiMock({})              
            };
            setupMocks(mocks);         
        
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
            



    } )


    describe( 'connect',()=>{
        const loginStartSpy = jest.fn();
        const loginSuccessSpy = jest.fn();
        const loginFailedSpy = jest.fn();
        const logSpy = jest.fn()
        

        beforeEach(()=>{
            service = new VeloHeroAppConnection()

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
         
            const success = await service.connect({username:'test',password:'test'});
            expect(success).toBe(true)

            expect(loginStartSpy).toHaveBeenCalled()
            expect(loginSuccessSpy).toHaveBeenCalled()

            expect(logSpy).toHaveBeenCalledWith({message:'VeloHero Login'})
            expect(logSpy).toHaveBeenCalledWith({message:'VeloHero Login success'})
            expect(logSpy).not.toHaveBeenCalledWith(expect.objectContaining({message:'error'}))

            expect(service.isConnecting()).toBe(false)    
            expect(mocks.userSettings?.set).toHaveBeenCalledWith('user.auth.velohero',{ id: expect.anything(), authKey: expect.anything() })
        })

        test('login failure',async ()=>{                    
            const mocks: MockDefinition = {
              userSettings: UserSettingsMock(true, null,'12345678-1111-2222-3333-123456789abc'),              
              api: ApiMock({loginError:'TEST'})
            };
            setupMocks(mocks);         

            let success
         
            await expect(async ()=>{ success = await service.connect({username:'test',password:'test'})}).rejects.toThrow('TEST')
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
            service = new VeloHeroAppConnection()
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




})