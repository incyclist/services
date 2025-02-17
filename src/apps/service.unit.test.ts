import { IActivityUpload } from "../activities/upload"
import { AppsService, useAppsService } from "./service"

const OC = (x) => expect.objectContaining(x)

describe ('AppService',()=>{


    const mock = (connected:boolean):Partial<IActivityUpload>  =>  ({
        isConnected: jest.fn().mockReturnValue(connected),
    })

    const connectedApp = mock(true)
    const notConnectedApp = mock(false)

    describe('getConnectedServices',()=>{

        let service:AppsService

        describe('ActivityUpload',()=>{
            service = useAppsService()

            const setupMocks = ( mockDef:Record<string, Partial<IActivityUpload>>)=>{

                service.inject('ActivityUploadFactory', {
                    get:jest.fn( (service:string) => mockDef[service])
                })
    
            }
    
            const cleanupMocks  = ()=>{
                service.inject('ActivityUploadFactory',null)
            }
    
            afterEach(()=>{
                cleanupMocks()  
            })
    
            
            test('all connected',()=>{
                setupMocks( {strava:connectedApp, velohero:connectedApp})
    
                const res = service.getConnectedServices('ActivityUpload')
                expect(res).toEqual([OC({name:'Strava', key:'strava'}),OC({name:'VeloHero', key:'velohero'})])
            })
    
    
            test('partially connected', () =>{
    
                setupMocks( {strava:notConnectedApp, velohero:connectedApp})
    
                const res = service.getConnectedServices('ActivityUpload')
                expect(res).toEqual([OC({name:'VeloHero', key:'velohero'})])
    
    
            })
            test('none connected',()=>{
                setupMocks( {strava:notConnectedApp, velohero:notConnectedApp})
    
                const res = service.getConnectedServices('ActivityUpload')
                expect(res).toEqual([])
    
            })

        })

        test('other operations',()=>{
            service = useAppsService()
            
            const res = service.getConnectedServices('WorkoutUpload')
            expect(res).toEqual([])
            
        })


    })
    
})