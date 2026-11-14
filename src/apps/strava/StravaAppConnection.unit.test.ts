import { ISecretBinding } from "../../api/secret";
import { Inject } from "../../base/decorators";
import { Observer } from "../../base/types";
import { UserSettingsService } from "../../settings";
import { waitNextTick } from "../../utils";
import { sleep } from "../../utils/sleep";
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

// STRAVA_CLIENT_ID/STRAVA_CLIENT_SECRET are no longer required client-side (FIXES_BACKLOG #61) -
// this mock simulates a client that never receives them (e.g. a version-gated secrets response)
const NoSecretMock = ():Partial<ISecretBinding> => ({
    getSecret:jest.fn( () => undefined)
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
    const cleanupMocks = () => {
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
            cleanupMocks() 
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


        test('connects even without STRAVA_CLIENT_ID/STRAVA_CLIENT_SECRET secrets (relaxed gate, matches IntervalsAppConnection)',()=>{

            const credentials:StravaCredentials = {accesstoken:'1',refreshtoken:'2',expiration:new Date(Date.now()+1000).toISOString()}

            const mocks: MockDefinition = {
                userSettings: UserSettingsMock(true, credentials,'12345678-0000-1111-2222-123456789abc'),
                bindings: NoSecretMock(),
                api: ApiMock({})
            };
            setupMocks(mocks);

            const success = service.init();
            expect(success).toBe(true)
            expect(logSpy).toHaveBeenCalledWith({message:'Strava init done', hasCredentials:true})
            expect(service.isConnected()).toBe(true)
            expect(service.isConnecting()).toBe(false)

        })

        // Credentials persisted by earlier app versions: expiration was always written as Date.toISOString(),
        // or is missing. These users must keep working after the credential parsing was generalized.
        describe('credentials persisted by earlier app versions',()=>{

            test.each([
                ['ISO string in the future', new Date(Date.now()+3600_000).toISOString()],
                ['ISO string in the past (expired token)', '2024-01-01T00:00:00.000Z'],
                ['ISO string with milliseconds', '2025-06-30T12:34:56.789Z'],
            ])('%s: loads, connects and keeps exactly the stored date',(_name,stored)=>{
                const mocks: MockDefinition = {
                    userSettings: UserSettingsMock(true, {accesstoken:'1',refreshtoken:'2',expiration:stored}),
                    bindings: SecretMock(),
                    api: ApiMock({})
                };
                setupMocks(mocks);

                const success = service.init();

                expect(success).toBe(true)
                expect(service.isConnected()).toBe(true)
                expect(logSpy).not.toHaveBeenCalledWith(expect.objectContaining({message:'error'}))

                const config = (mocks.api?.init as jest.Mock).mock.calls[0][0] as StravaConfig
                expect(config.expiration).toBeInstanceOf(Date)
                expect(config.expiration?.toISOString()).toBe(new Date(stored).toISOString())
                expect(config.accessToken).toBe('1')
                expect(config.refreshToken).toBe('2')
            })

            test('no expiration stored: loads and connects, the token will be refreshed on first use',()=>{
                const mocks: MockDefinition = {
                    userSettings: UserSettingsMock(true, {accesstoken:'1',refreshtoken:'2'}),
                    bindings: SecretMock(),
                    api: ApiMock({})
                };
                setupMocks(mocks);

                const success = service.init();

                expect(success).toBe(true)
                expect(service.isConnected()).toBe(true)
                expect(logSpy).not.toHaveBeenCalledWith(expect.objectContaining({message:'error'}))
                const config = (mocks.api?.init as jest.Mock).mock.calls[0][0] as StravaConfig
                expect(config.expiration).toBeUndefined()
            })

            test('stored credentials are written back unchanged after a token refresh',async ()=>{
                const stored = '2024-01-01T00:00:00.000Z'
                const refresh:StravaConfig = {accessToken:'n1',refreshToken:'n2',expiration:new Date('2026-01-01T00:00:00Z'),clientId:'1',clientSecret:'2'}
                const mocks: MockDefinition = {
                    userSettings: UserSettingsMock(true, {accesstoken:'1',refreshtoken:'2',expiration:stored}),
                    bindings: SecretMock(),
                    api: ApiMock({tokenUpdate:refresh})
                };
                setupMocks(mocks);

                service.init();
                await waitNextTick()

                expect(mocks.userSettings?.set).toHaveBeenCalledWith('user.auth.strava',{
                    accesstoken: 'n1',
                    refreshtoken: 'n2',
                    expiration: '2026-01-01T00:00:00.000Z'
                })
            })
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
            cleanupMocks() 
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

        test('already connected: also persists the new credentials',async ()=>{
            const credentials:StravaCredentials = {accesstoken:'1',refreshtoken:'2',expiration:new Date(Date.now()+1000).toISOString()}
            const mocks: MockDefinition = {
                userSettings: UserSettingsMock(true, credentials,'12345678-0000-1111-2222-123456789abc'),
                bindings: SecretMock(),
                api: ApiMock({})
            };
            setupMocks(mocks);

            await service.connect({accesstoken:'new', refreshtoken:'new2', expiration:new Date('2024-01-01').toISOString()});

            expect(mocks.api?.update).toHaveBeenCalledWith(expect.objectContaining({accessToken:'new', refreshToken:'new2'}))
            expect(mocks.userSettings?.set).toHaveBeenCalledWith('user.auth.strava',{
                accesstoken: 'new',
                refreshtoken: 'new2',
                expiration: '2024-01-01T00:00:00.000Z'
            })
        })

        test('expiration as epoch milliseconds',async ()=>{
            const mocks: MockDefinition = {
                userSettings: UserSettingsMock(true, null),
                bindings: SecretMock(),
                api: ApiMock({})
            };
            setupMocks(mocks);

            await service.connect({id:42, accesstoken:'a', refreshtoken:'b', expiration:String(Date.UTC(2026,0,1,10))});

            expect(mocks.userSettings?.set).toHaveBeenCalledWith('user.auth.strava',expect.objectContaining({
                expiration: '2026-01-01T10:00:00.000Z'
            }))
        })

        test('invalid expiration does not break the connect (token is treated as expired)',async ()=>{
            const mocks: MockDefinition = {
                userSettings: UserSettingsMock(true, null),
                bindings: SecretMock(),
                api: ApiMock({})
            };
            setupMocks(mocks);

            const success = await service.connect({accesstoken:'a', refreshtoken:'b', expiration:'garbage'});

            expect(success).toBe(true)
            expect(mocks.userSettings?.set).toHaveBeenCalledWith('user.auth.strava',expect.objectContaining({expiration: undefined}))
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
            cleanupMocks() 
            service.reset()
        })

        test('perform disconnect',()=>{                    
            const mocks: MockDefinition = {
                userSettings: UserSettingsMock(true, null),                            
                api: ApiMock({})
            };
            setupMocks(mocks);         

            service.disconnect();            
            expect(service.isConnected()).toBe(false)
            expect(mocks.userSettings?.set).toHaveBeenCalledWith('user.auth.strava',null)
        })         
    


    } )




})