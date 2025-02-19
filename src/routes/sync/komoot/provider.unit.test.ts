import { Inject } from '../../../base/decorators'
import {KomootSyncProvider} from './provider'
import tours from '../../../../__tests__/data/apps/komoot/tour_planned.json'
import coordinates from '../../../../__tests__/data/apps/komoot/coordinates.json'
import { RouteInfo } from '../../base/types'
import { UserSettingsService } from '../../../settings'
import { Route } from '../../base/model/route'



describe( 'Komoot Route Sync Provider ',()=>{ 

    let syncProvider: KomootSyncProvider
    let userSettingsSet = jest.fn()
    const getIsoFromLatLng = jest.fn().mockResolvedValue('DE')

    const UserSettingsMock = (initialized:boolean, data):Partial<UserSettingsService>=>({
        isInitialized: initialized,
        get: jest.fn( (key,defValue) => data?.[key]??defValue),
        set: userSettingsSet
    })

    const setupMocks = (sp, mocks:Record<string,any>, props:{userSettings?,enabled?,routes?}={}) => {
       
        Object.keys(mocks).forEach( key => {
            if (key!=='api')
                sp[key] = mocks[key]
        })    

        Inject('Countries', {getIsoFromLatLng})
        Inject('UserSettings', UserSettingsMock(props.userSettings!==undefined, props.userSettings))
        Inject('AppsService',{
            isEnabled: jest.fn().mockReturnValue( props.enabled??true)
        })
        Inject('RouteListService',{
            getAllAppRoutes: jest.fn().mockReturnValue( props?.routes??[])
        })

        if (mocks.connection)
            Inject( 'KomootAppConnection',mocks.connection)

        if (mocks.api) {
            Inject('KomootApi',mocks.api)
        }
    }

    const cleanupMocks = ()=>{
        Inject('Countries', null)
        Inject('UserSettings', null)
        Inject('AppsService',null)    
        Inject('RouteListService',null)  
        jest.clearAllMocks()  
    }

    describe('sync',()=>{

        beforeEach( ()=> {
            syncProvider = new KomootSyncProvider()
        })

        afterEach( ()=>{
            cleanupMocks()
        })


        test('successfull intiial load',async ()=>{
            
            setupMocks(syncProvider, {
                    api: {
                        getTours: jest.fn()
                            .mockResolvedValueOnce(tours)
                            .mockResolvedValueOnce([]),
                        getTourCoordinates: jest.fn().mockResolvedValue(coordinates),
                        isAuthenticated: jest.fn().mockReturnValue(true)
                    },
                    connection: {
                        isConnected:jest.fn().mockReturnValue(true)
                    }                
                }
            )

            const res = await new Promise(done=> {
                let routes:Array<RouteInfo> = []
                const observer = syncProvider.sync()
                observer.on('added', (route=>routes.push(...route)))
                observer.on('done',()=>done(routes))
            }) 

            expect(res).toHaveLength(41)            
            expect(userSettingsSet).toHaveBeenCalledWith('apps.komoot.lastSync',expect.any(Number))
        })


        test('disabled',async ()=>{
            
            setupMocks(syncProvider, {
                    api: {
                        getTours: jest.fn()
                            .mockResolvedValueOnce(tours)
                            .mockResolvedValueOnce([]),
                        getTourCoordinates: jest.fn().mockResolvedValue(coordinates),
                        isAuthenticated: jest.fn().mockReturnValue(true)
                    },
                    connection: {
                        isConnected:jest.fn().mockReturnValue(true)
                    }                
                }, {enabled:false}
            )

            const res = await new Promise(done=> {
                let routes:Array<RouteInfo> = []
                const observer = syncProvider.sync()
                observer.on('added', (route=>routes.push(...route)))
                observer.on('done',()=>done(routes))
            }) 

            expect(res).toHaveLength(0)            
            expect(userSettingsSet).not.toHaveBeenCalledWith('apps.komoot.lastSync',expect.any(Number))
        })


    })

    describe('loadDetails',()=>{

        beforeEach( ()=> {
            syncProvider = new KomootSyncProvider()
        })

        test('successfull intiial load',async ()=>{
            setupMocks(syncProvider, {
                    api: {
                        getTours: jest.fn()
                            .mockResolvedValueOnce(tours)
                            .mockResolvedValueOnce([]),
                        getTourCoordinates: jest.fn().mockResolvedValue(coordinates),
                        isAuthenticated: jest.fn().mockReturnValue(true)
                    },
                    connection: {
                        isConnected:jest.fn().mockReturnValue(true)
                    }                

                } 
                
            )
      

            const route = new Route( { id: 'komoot:1868570044', title:'test',hasGpx:true} )

            const res = await syncProvider.loadDetails(route)
            
            const details = {...res.details}
            delete details.points

            const description = {...res.description}
            delete description.points


            expect(details).toMatchSnapshot()
            expect(description).toMatchSnapshot()
            expect(res.details.points).toMatchSnapshot()
            expect(getIsoFromLatLng).toHaveBeenCalledTimes(1)
            


        })


    })

})