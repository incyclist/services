import { EventEmitter } from 'node:events'
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
                    get:jest.fn( (service:string) => mockDef[service]),
                    isUploadEnabled:jest.fn( (service:string) => mockDef[service]?.isConnected())
                })
    
            }
    
            const cleanupMocks  = ()=>{
                service.inject('ActivityUploadFactory',null)
            }
    
            afterEach(()=>{
                cleanupMocks()  
            })
    
            
            test('all connected',()=>{
                setupMocks( {strava:connectedApp, intervals:connectedApp})
    
                const res = service.getConnectedServices('ActivityUpload')
                expect(res).toEqual([OC({name:'Strava', key:'strava'}),OC({name:'Intervals.icu', key:'intervals'})])
            })
    
    
            test('partially connected', () =>{
    
                setupMocks( {strava:notConnectedApp, intervals:connectedApp})
    
                const res = service.getConnectedServices('ActivityUpload')
                expect(res).toEqual([OC({name:'Intervals.icu', key:'intervals'})])
    
    
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

    describe('TrainerDay (always registered)',()=>{
        let service:AppsService

        beforeEach(()=>{
            service = new AppsService()
        })

        afterEach(()=>{
            service.inject('UserSettings',null)
            service.reset()
        })

        test('the app is known without opening the settings and without any user setting',()=>{
            service.inject('UserSettings', { isInitialized: false, getValue: jest.fn() })

            expect(service.getName('trainerday')).toBe('TrainerDay')
            expect(service.getKey('TrainerDay')).toBe('trainerday')
            expect(service.isConnected('trainerday')).toBe(false)
        })

        test('the app is part of the apps settings',()=>{
            service.inject('UserSettings', { isInitialized: true, getValue: jest.fn( (_key:string, defValue:unknown) => defValue) })

            expect(service.openSettings()).toContainEqual({name:'TrainerDay', key:'trainerday', isConnected:false})
        })
    })

    describe('RideWithGPS (always registered)',()=>{
        let service:AppsService

        beforeEach(()=>{
            service = new AppsService()
            service.inject('UserSettings', { isInitialized: false, getValue: jest.fn() })
        })

        afterEach(()=>{
            service.inject('UserSettings',null)
            service.reset()
        })

        // regression: a connection that was removed because its token was rejected was not reported to the UI
        test('an authentication failure of the connection is reported as disconnected',()=>{
            const onDisconnected = jest.fn()
            service.on('disconnected', onDisconnected)

            const connection = service['getAppConnection']('ridewithgps') as unknown as EventEmitter
            connection.emit('auth.failed')

            expect(onDisconnected).toHaveBeenCalledWith('ridewithgps')
            expect(onDisconnected).toHaveBeenCalledTimes(1)
        })

        test('the app is known and supports upload and route download',()=>{
            expect(service.getName('ridewithgps')).toBe('RideWithGPS')
            expect(service.getKey('RideWithGPS')).toBe('ridewithgps')
            expect(service.getAvailableServices('ActivityUpload')).toContain('ridewithgps')
            expect(service.getAvailableServices('RouteDownload')).toContain('ridewithgps')
            expect(service.getAvailableServices('WorkoutDownload')).not.toContain('ridewithgps')
        })
    })

    describe('TrainingPeaks (enabled by the user setting TP_INTEGRATION)',()=>{
        let service:AppsService

        const settingsMock = (initialized:boolean, enabled:boolean) => ({
            isInitialized: initialized,
            getValue: jest.fn( (key:string, defValue:unknown) => key==='TP_INTEGRATION' ? enabled : defValue)
        })

        const uploadFactoryMock = (connected:string[]) => ({
            get: jest.fn( (key:string) => ({ isConnected: jest.fn().mockReturnValue(connected.includes(key)) })),
            isUploadEnabled: jest.fn( (key:string) => connected.includes(key))
        })

        beforeEach(()=>{
            service = new AppsService()
        })

        afterEach(()=>{
            service.inject('UserSettings',null)
            service.inject('ActivityUploadFactory',null)
            service.reset()
        })

        test('not enabled: the app is not available',()=>{
            service.inject('UserSettings', settingsMock(true,false))

            expect(service.getAvailableServices('ActivityUpload')).not.toContain('trainingpeaks')
            expect(service.openSettings().map(a=>a.key)).toEqual(['strava','komoot','intervals','trainerday','ridewithgps'])
        })

        // regression: the app was only added when the settings of the apps were opened. Until then the activity upload did not know it
        // (e.g. the upload status of an activity was not shown after the start of the app)
        test('enabled: the app is known without opening the settings of the apps',()=>{
            service.inject('UserSettings', settingsMock(true,true))
            service.inject('ActivityUploadFactory', uploadFactoryMock(['trainingpeaks']))

            expect(service.getAvailableServices('ActivityUpload')).toContain('trainingpeaks')
            expect(service.getAvailableServices('WorkoutDownload')).toContain('trainingpeaks')
            expect(service.getConnectedServices('ActivityUpload')).toEqual([OC({name:'TrainingPeaks', key:'trainingpeaks'})])
            expect(service.getName('trainingpeaks')).toBe('TrainingPeaks')
            expect(service.getKey('TrainingPeaks')).toBe('trainingpeaks')
        })

        test('enabled: the app is part of the apps settings',()=>{
            service.inject('UserSettings', settingsMock(true,true))

            expect(service.openSettings()).toEqual([
                OC({key:'strava'}), OC({key:'komoot'}), OC({key:'intervals'}), OC({key:'trainerday'}), OC({key:'ridewithgps'}), {name:'TrainingPeaks', key:'trainingpeaks', isConnected:false}
            ])
        })

        test('enabled: the app is only added once',()=>{
            service.inject('UserSettings', settingsMock(true,true))

            service.openSettings()
            service.getAvailableServices('ActivityUpload')
            const apps = service.openSettings()

            expect(apps.filter(a=>a.key==='trainingpeaks')).toHaveLength(1)
        })

        test('user settings are not initialized yet when the service is used: the app is added as soon as they are',()=>{
            service.inject('UserSettings', settingsMock(false,true))
            expect(service.getAvailableServices('ActivityUpload')).not.toContain('trainingpeaks')

            service.inject('UserSettings', settingsMock(true,true))
            expect(service.getAvailableServices('ActivityUpload')).toContain('trainingpeaks')
        })

        test('user settings can not be read: the app is not available, nothing fails',()=>{
            service.inject('UserSettings', { isInitialized:true, getValue: jest.fn( ()=>{ throw new Error('ERROR')}) })

            expect(()=>service.getAvailableServices('ActivityUpload')).not.toThrow()
            expect(service.getAvailableServices('ActivityUpload')).not.toContain('trainingpeaks')
        })

        test('enabled: other apps are not affected',()=>{
            service.inject('UserSettings', settingsMock(true,true))
            service.inject('ActivityUploadFactory', uploadFactoryMock(['strava','intervals']))

            expect(service.getConnectedServices('ActivityUpload')).toEqual([OC({key:'strava'}),OC({key:'intervals'})])
        })
    })

})
