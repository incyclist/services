import { SerialCommsState } from "incyclist-devices/lib/serial/kettler/comms"
import { Inject } from "../../base/decorators/Injection"
import { Observer } from "../../base/types"
import { waitNextTick } from "../../utils"
import { ActivitiesRepository, Activity, ActivityDetails, ActivityInfo, ActivitySummary } from "../base"
import { ActivityListService } from "./service"
import { ActivityListDisplayProperties } from "./types"
import SampleDetails from '../../../__tests__/data/activities/v3.json'
import { sleep } from "../../utils/sleep"
import { RouteInfo } from "../../routes/base/types"
import clone from "../../utils/clone"

const MockActivitySummary = (id):ActivitySummary=> ({
    id,
    title: "Incyclist Ride",
    name: "Incyclist Ride-20240524151947",
    routeId: "d0d385b11449341dd306d8030ec1359f",
    previewImage: "./screenshot-20240524160316.jpg",
    startTime: 1716556878000,
    rideTime: 72228.207,
    distance: 51694.21911026363,
    startPos: 0,
    realityFactor: 100,
    uploadStatus: [],
    routeHash: "d0d385b11449341dd306d8030ec1359f",
    totalElevation: 0
})



type MockDefinition = {
    repo?:Partial<ActivitiesRepository>
    initialized?:boolean
    listOpened?:boolean
    repoError?:string
    selected?:ActivityInfo
    routeMissing?:boolean
}

const waitForEvent = (observer,event,props:{timeout,spy}) => {
    return new Promise((resolve) => {
        if (props.spy)
            observer.on(event,props.spy)
        observer.on(event,resolve)
        
        setTimeout(()=>{resolve(null)}, props.timeout)
    })
}

const RepoMock = (props):Partial<ActivitiesRepository>  => new RepoMockClass(props).mock

class RepoMockClass {
    
    public observer 
    public props
    public mock
    public activities:Array<ActivityInfo>

    constructor (props:{cntEntries?, loadError?, FilterRes?,getDetailsError?,repoDelay?,searchFn?})  { 
        this.observer = new Observer()
        this.props = props
        this.mock  = { 
            load:jest.fn().mockReturnValue( this.observer),
            search:jest.fn().mockReturnValue( []),
            getAll:jest.fn().mockReturnValue([]),
            delete:jest.fn( id=> { return this.delete(id)}),
            getWithDetails:jest.fn( id=> { return this.getWithDetails(id)}),
            migrate:jest.fn()
        }
        this.initFromProps()
    }

    get() {
        return this.mock
    }

    async getWithDetails(id:string) {
        //console.log(new Date().toISOString(),'getWithDetails',id)
        if (this.props.getDetailsError) {
            throw new Error(this.props.getDetailsError)
        }
        if (this.props.repoDelay)
            await sleep( this.props.repoDelay)
        await waitNextTick()


        const activity =  this.activities.find( r=>r.summary.id===id)
        if (!activity)
            throw new Error('Activity not found')

        activity.details = this.props.details??clone(SampleDetails)
        //console.log(new Date().toISOString(),'getWithDetails done',id)
        return activity;
    }

    async delete(id:string ):Promise<void> {
        if (this.props.deleteError) {
            throw new Error(this.props.deleteError)
        }

        const record = this.activities.find( r=>r.summary.id===id)
        if (record) {
            this.activities.splice(this.activities.indexOf(record),1)
        }
    }

    initFromProps () {
        const {props,mock,observer} = this
        
        if (props.cntEntries!==undefined) { 
            this.activities  = []
            for (let i=0;i<props.cntEntries;i++) {
                const summary = MockActivitySummary(`activity-${i}`)
                this.activities.push( {summary} )
            }
    
            mock.load = jest.fn( ()=>{
                waitNextTick().then( () =>  {
                    for (let i=0;i<props.cntEntries;i++) {
                        observer.emit('added', this.activities[i].summary)
                    }
                    observer.emit('done')
                })
                return observer
            })
            mock.getAll = jest.fn( ()=>{
                return this.activities
            })        
            mock.search = jest.fn( ()=>{
                return this.activities
            })        
        }
    
        if (props.loadError) {
            mock.load = jest.fn(  ()=>{ 
                waitNextTick().then( ()=>{
                    observer.emit('error',new Error(props.loadError))
                })
                return observer
            })
        }

        if (props.searchFn) {   
            mock.search = jest.fn( filter=> {
                return props.searchFn(filter, this.activities)
            })
        }
    
    
    }

        


}



describe('ActivityListService',()=>{


    let service:ActivityListService
    const spyLog = jest.fn()

    const setupMocks = (mocks:MockDefinition) =>{
        Inject('Repo', mocks.repo)
        Inject('Bindings', {
            fs: {
                existsFile:jest.fn().mockResolvedValue(true)
            }
        })
        Inject('RouteList', {
            getRouteDescription: jest.fn().mockReturnValue(mocks.routeMissing ? undefined :  {}),
        })
        service.on('log',spyLog)

        if (mocks.initialized) {
            service['initialized'] = true
            service['preloadObserver']
        }
        if (mocks.listOpened) { 
            service['observer'] = new Observer()
        }
        if (mocks.selected) {   
            service['selected'] = new Activity(mocks.selected)
        }


        return mocks
    }

    const cleanupMocks = () =>{
        Inject('Repo', null)
        Inject('Bindings', null)
        Inject('RouteList', null)
        jest.resetAllMocks()
    }

    describe('preload',()=>{
        beforeEach( ()=>{
            service = new ActivityListService()

        })

        afterEach( ()=>{
            cleanupMocks()
            service.reset()
        })

        test('normal',async ()=>{
            const mocks = setupMocks({repo:RepoMock({cntEntries:5})})


            const  o = service.preload()

            expect(service.isStillLoading()).toBe(true)
            await o.wait()
            await waitNextTick()

            expect(mocks.repo?.load).toHaveBeenCalledWith()
            expect(mocks.repo?.load).toHaveBeenCalledTimes(1)
            expect(service.isStillLoading()).toBe(false)

            expect(spyLog).toHaveBeenCalledWith({message:'preload activity list'})
            expect(spyLog).toHaveBeenCalledWith({message:'preload activity list completed',cnt:5})
        })


        test('loading error',async ()=>{
            const mocks = setupMocks({repo:RepoMock({loadError:'XXX'})})

            await  service.preload().wait()
            expect(mocks.repo?.load).toHaveBeenCalledWith()
            expect(mocks.repo?.load).toHaveBeenCalledTimes(1)

            expect(spyLog).toHaveBeenCalledWith({message:'preload activity list'})
            expect(spyLog).not.toHaveBeenCalledWith({message:'preload activity list completed',cnt:expect.anything()})
            expect(spyLog).toHaveBeenCalledWith({message:'Error',fn:'preload',error:'XXX',stack:expect.anything()})
        })


        test('parallel preloads',async ()=>{
            const mocks = setupMocks({repo:RepoMock({cntEntries:5})})

            const o1 = service.preload()
            const o2 = service.preload()

            await o1.wait()
            await o2.wait()
            expect(mocks.repo?.load).toHaveBeenCalledWith()
            expect(mocks.repo?.load).toHaveBeenCalledTimes(1)
            expect(o1).toBe(o2)

            expect(spyLog).toHaveBeenCalledWith({message:'preload activity list'})
            expect(spyLog).toHaveBeenCalledWith({message:'waiting for current activity preload'})
            expect(spyLog).toHaveBeenCalledWith({message:'preload activity list completed',cnt:expect.anything()})
        })

    })

    describe('openList',()=>{
        beforeEach( async ()=>{
            service = new ActivityListService()
        })

        afterEach( ()=>{
            cleanupMocks()
            service.reset()
        })

        test('first launch after activities have been loaded',async ()=>{
            const mocks = setupMocks({repo:RepoMock({cntEntries:5})})
            await service.preload().wait()

            const res = service.openList()       

            expect(res.loading).toBe(false)
            expect(res.observer).toBeUndefined()
            expect(res.activities?.length).toBe(5)

            // no details loaded yet
            const details = res.activities?.map( a => a.details ).filter( s => s!==undefined )??[]
            expect(details.length).toBe(0)

            expect(service.getListTop()).toBeUndefined()
            
        })
        test('not yet loaded',async ()=>{
            const mocks = setupMocks({repo:RepoMock({cntEntries:5})})

            const res = service.openList()       

            expect(res.loading).toBe(true)
            expect(res.observer).toBeDefined()
            expect(res.activities).toBeUndefined()

            // no details loaded yet
            const details = res.activities?.map( a => a.details ).filter( s => s!==undefined )??[]
            expect(details.length).toBe(0)

            const observer = service.getObserver()
            expect(res.observer).toBe(observer)

            const finalize = ():Promise<ActivityListDisplayProperties|undefined> => new Promise(done=>{
                res.observer?.on('loaded',done)
                setTimeout( ()=>{ done(undefined)},1000)
            })

            const loaded = await finalize()
            expect(loaded?.loading).toBe(false)
            expect(loaded?.observer).toBeUndefined()
            expect(loaded?.activities?.length).toBe(5)
        })


        test('open - close - open',async ()=>{
            const mocks = setupMocks({repo:RepoMock({cntEntries:5})})
            await service.preload().wait()

            service.openList()       
            const observer1 = service.getObserver()
            expect(service.getListTop()).toBeUndefined()

            service.setListTop(100)
            service.closeList()


            service.openList()       
            const observer2 = service.getObserver()
            expect(service.getListTop()).toBeUndefined()

            expect(observer1).not.toBe(observer2)
        })


    })
    describe('getActivityDetails',()=>{
        beforeEach( async ()=>{
            service = new ActivityListService()
        })

        afterEach( ()=>{
            cleanupMocks()
            service.reset()
        })

        test('details not yet loaded and available',async ()=>{
            const mocks = setupMocks({repo:RepoMock({cntEntries:5}),initialized:true,listOpened:true})
            
            const listObserver = service.getObserver()
            const listSpy = jest.fn()
            listObserver.on('loaded',listSpy)
            listObserver.on('updated',listSpy)

            const itemObserver = service.getActivityDetails('activity-1')

            const itemSpy = jest.fn()
            const data = await waitForEvent(itemObserver,'loaded', {spy:itemSpy, timeout:100})

            expect(listSpy).not.toHaveBeenCalled()  // no re-render of list required
            expect(itemSpy).toHaveBeenCalled()  //  re-render of item required
            expect(data).toMatchObject(SampleDetails)

            expect(mocks.repo?.getAll).toHaveBeenCalled()
            expect(mocks.repo?.getWithDetails).toHaveBeenCalledWith('activity-1')

        })

        test('details already loaded',async ()=>{
            
            const db = new RepoMockClass({cntEntries:5})
            db.activities[1].details = clone(SampleDetails) as unknown as ActivityDetails            
            const mocks = setupMocks({repo:db.mock,initialized:true,listOpened:true})
            

            const listObserver = service.getObserver()
            const listSpy = jest.fn()
            listObserver.on('loaded',listSpy)
            listObserver.on('updated',listSpy)

            const itemObserver = service.getActivityDetails('activity-1')

            const itemSpy = jest.fn()
            const data = await waitForEvent(itemObserver,'loaded', {spy:itemSpy, timeout:100})

            expect(listSpy).not.toHaveBeenCalled()  // no re-render of list required
            expect(itemSpy).toHaveBeenCalled()  //  re-render of item required
            expect(data).toMatchObject(SampleDetails)

            expect(mocks.repo?.getAll).toHaveBeenCalled()
            expect(mocks.repo?.getWithDetails).not.toHaveBeenCalled()

        })

        test('repo error',async ()=>{
            
            
            setupMocks({repo:RepoMock({cntEntries:5,getDetailsError:'XXX'}),initialized:true,listOpened:true})
            

            const listObserver = service.getObserver()
            const listSpy = jest.fn()
            listObserver.on('loaded',listSpy)
            listObserver.on('updated',listSpy)

            const itemObserver = service.getActivityDetails('activity-1')

            const itemSpy = jest.fn()

            await waitForEvent(itemObserver,'load-error', {spy:itemSpy, timeout:100})

            expect(listSpy).not.toHaveBeenCalled()  // no re-render of list required
            expect(itemSpy).toHaveBeenCalledWith('XXX')  // no-re-render of item required

            expect(spyLog).toHaveBeenCalledWith({message:'Error',fn:'getActivityDetails#getWithDetails',error:'XXX',stack:expect.anything()})    
            
        })


    })

    describe('select',()=>{

        beforeEach( async ()=>{
            service = new ActivityListService()
        })

        afterEach( ()=>{
            cleanupMocks()
            service.reset()
        })

        test('details not yet loaded and available',async ()=>{
            const mocks = setupMocks({repo:RepoMock({cntEntries:5,repoDelay:100}),initialized:true,listOpened:true})
            

            const res = service.select('activity-1')
            expect(res).toBe(true)
            expect(mocks.repo?.getAll).toHaveBeenCalled()

            const selected = service.getSelected()
            expect(selected.id).toBe('activity-1')
            expect(selected.isLoading()).toBe(true)
            expect(selected.isComplete()).toBe(false)

            await waitNextTick()
            expect(mocks.repo?.getWithDetails).toHaveBeenCalledWith('activity-1')

        })

        test('details already loaded',async ()=>{

            const db = new RepoMockClass({cntEntries:5,repoDelay:100})
            db.activities[1].details = clone(SampleDetails) as unknown as ActivityDetails            
            const mocks = setupMocks({repo:db.mock,initialized:true,listOpened:true})
           

            const res = service.select('activity-1')
            expect(res).toBe(true)
            expect(mocks.repo?.getAll).toHaveBeenCalled()

            const selected = service.getSelected()
            expect(selected.id).toBe('activity-1')
            expect(selected.isLoading()).toBe(false)
            expect(selected.isComplete()).toBe(true)

            await waitNextTick()
            expect(mocks.repo?.getWithDetails).not.toHaveBeenCalledWith('activity-1')
        })


        test('details not yet loaded and repo error',async ()=>{
            const mocks = setupMocks({repo:RepoMock({cntEntries:5,getDetailsError:'XXX'}),initialized:true,listOpened:true})
           

            const res = service.select('activity-1')
            expect(res).toBe(true)

            const selected = service.getSelected()
            expect(selected.id).toBe('activity-1')
            expect(selected.isLoading()).toBe(true)
            expect(selected.isComplete()).toBe(false)

            // we need to wait two ticks, otherwise the error is not picked up
            await waitNextTick()
            await waitNextTick()

            expect(mocks.repo?.getWithDetails).toHaveBeenCalledWith('activity-1')
            expect(selected.isLoading()).toBe(false)
            expect(selected.isComplete()).toBe(false)

        })

        test('actrivity not found',async ()=>{
            const mocks = setupMocks({repo:RepoMock({cntEntries:5,getDetailsError:'XXX'}),initialized:true,listOpened:true})
           

            const res = service.select('activity-123')
            expect(res).toBe(false)

            const selected = service.getSelected()
            expect(selected).toBeUndefined()

            expect(mocks.repo?.getWithDetails).not.toHaveBeenCalled()
        })


    })


    describe('openSelected',()=>{

        beforeEach( async ()=>{
            service = new ActivityListService()
        })

        afterEach( ()=>{
            cleanupMocks()
            service.reset()
        })

        test('normal',async ()=>{

            const db = new RepoMockClass({cntEntries:5,repoDelay:100})
            db.activities[1].details = clone(SampleDetails) as unknown as ActivityDetails    
            const selected = db.activities[1]
            setupMocks({repo:db.mock,initialized:true,listOpened:true,selected})
            
            let res
            res = service.openSelected()

            const waitForFinalResult = (to:number)=> {
                return new Promise<void>(resolve => {
                    let isDone = false

                    const done = ()=> {
                        if (isDone)
                            return
                        isDone = true
                        resolve()

                    }
                    setTimeout(done,to)
                    service.getObserver().once('updated',(update)=>{
                        res = update
                        done()
                    })
                })

            }

            await waitForFinalResult(500)

            
            delete res.points   
            delete res.activity 
            expect(res).toMatchSnapshot()

        })

        test('no item selected',async ()=>{

            const db = new RepoMockClass({cntEntries:5,repoDelay:100})
            db.activities[1].details = clone(SampleDetails) as unknown as ActivityDetails    
            setupMocks({repo:db.mock,initialized:true,listOpened:true})
            
            let res
            res = service.openSelected()
            
            expect(res.title).toBe('Activity')
            expect(res.error).toBe('No activity selected')

        })

        test('seleced items does not have logs',()=>{
            const db = new RepoMockClass({cntEntries:5,repoDelay:100})

            const activity = clone(SampleDetails)
            delete activity.logs
            db.activities[1].details = activity as unknown as ActivityDetails    
           
            const selected = db.activities[1]
            setupMocks({repo:db.mock,initialized:true,listOpened:true,selected})
            
            
            let res
            res = service.openSelected()
            
            expect(res.title).toBe('Menglonnais')
            expect(res.points).toHaveLength(0)

        })


    })


    describe('closeSelected',()=>{
        beforeEach( async ()=>{
            service = new ActivityListService()
        })

        afterEach( ()=>{
            cleanupMocks()
            service.reset()
        })

        test('normal',async ()=>{

            const db = new RepoMockClass({cntEntries:5,repoDelay:100})
            db.activities[1].details = clone(SampleDetails) as unknown as ActivityDetails    
            const selected = db.activities[1]
            setupMocks({repo:db.mock,initialized:true,listOpened:true,selected})
            
            
            service.closeSelected()

            let res
            res = service.openSelected()
            expect(res.error).toBe('No activity selected')
        })


        test('keep selected',async ()=>{

            const db = new RepoMockClass({cntEntries:5,repoDelay:100})
            db.activities[1].details = clone(SampleDetails) as unknown as ActivityDetails    
            const selected = db.activities[1]
            setupMocks({repo:db.mock,initialized:true,listOpened:true,selected})
            
            
            service.closeSelected(true)

            let res
            res = service.openSelected()
            expect(res.error).toBeUndefined
        })

        // Test case "no item selected" - does not make sense, as nothing is done


    })
    describe('rideAgain',()=>{

        const O = (o)=>expect.objectContaining(o)
        
        beforeEach( async ()=>{
            service = new ActivityListService()

            const db = new RepoMockClass({cntEntries:5,repoDelay:100})
            db.activities[1].details = clone(SampleDetails) as unknown as ActivityDetails    
            const selected = db.activities[1]
            const  mocks = setupMocks({repo:db.mock,initialized:true,listOpened:true,selected})
        })

        afterEach( ()=>{
            cleanupMocks()
            service.reset()
        })


        test('route can be started',async ()=>{
            const target = service.getSelected()
            const route:Partial<RouteInfo> = {
                title:'TITLE',
                id:'123',
                videoUrl:'some URL',
            }
            target.canStart = jest.fn().mockReturnValue(true)
            target.getRouteCard = jest.fn().mockReturnValue({
                changeSettings: jest.fn(),
                start:jest.fn(),
                getCardType:jest.fn().mockReturnValue('Video'),
                getRouteDescription:jest.fn().mockReturnValue(route)
            })

            const {canStart} = service.rideAgain()
            expect(canStart).toBe(true)

            const card = target.getRouteCard()
            expect(target.canStart).toHaveBeenCalledTimes(1)            
            expect(card.changeSettings).toHaveBeenCalledWith(O({startPos:6900, realityFactor:100, type:'Video', showPrev:true}))
            expect(card.start).toHaveBeenCalledTimes(1)
        })    

        test('route cannot be started',async ()=>{
            const target = service.getSelected()
            target.canStart = jest.fn().mockReturnValue(false)
            target.getRouteCard = jest.fn().mockReturnValue({
                changeSettings: jest.fn(),
                start:jest.fn(),
                getCardType:jest.fn().mockReturnValue('Video')
            })

            const {canStart} = service.rideAgain()
            expect(canStart).toBe(false)

            const card = target.getRouteCard()
            expect(target.canStart).toHaveBeenCalledTimes(1)            
            expect(card.changeSettings).not.toHaveBeenCalled()
            expect(card.start).not.toHaveBeenCalled()
        })    

        test('no route selected',async ()=>{

            service.getSelected = jest.fn().mockReturnValue(null)
            const {canStart} = service.rideAgain()
            expect(canStart).toBe(false)
        })    

    })


    describe('export',()=>{

        const O = (o)=>expect.objectContaining(o)
        const mockExport= (success,error?) =>{

            return async (format,observer):Promise<boolean> => {
                if (observer)
                    observer.emit('export',{status:'started',format})
    
                await waitNextTick()
                if (observer) {
                    observer.emit('export',{status:'done',format,success,error})
                }
                return success                    
            }
            
        }
        
        beforeEach( async ()=>{
            service = new ActivityListService()

            const db = new RepoMockClass({cntEntries:5,repoDelay:100})
            db.activities[1].details = clone(SampleDetails) as unknown as ActivityDetails    
            const selected = db.activities[1]
            setupMocks({repo:db.mock,initialized:true,listOpened:true,selected})
        })

        afterEach( ()=>{
            cleanupMocks()
            service.reset()
        })


        test('successfull export',async ()=>{
            const target = service.getSelected()
            const route:Partial<RouteInfo> = {
                title:'TITLE',
                id:'123',
            }
            
            target.export = jest.fn(mockExport(true) )
            const observer = service.getObserver()
            const updatedSpy = jest.fn()
            observer.on('updated',updatedSpy)

            const success = await service.export('tcx')
            expect(success).toBe(true)
            expect(target.export).toHaveBeenCalledWith('tcx',expect.any(Observer))
            expect(updatedSpy).toHaveBeenCalledTimes(2)            
        })    

        test('export fails',async ()=>{
            const target = service.getSelected()
            const route:Partial<RouteInfo> = {
                title:'TITLE',
                id:'123',
            }
            
            target.export = jest.fn(mockExport(false,'XXX') )
            const observer = service.getObserver()
            const updatedSpy = jest.fn()
            observer.on('updated',updatedSpy)

            const success = await service.export('fit')
            expect(success).toBe(false)
            expect(target.export).toHaveBeenCalledWith('fit',expect.any(Observer))
            expect(updatedSpy).toHaveBeenCalledTimes(2)            
        })    
    })    

    describe('upload',()=>{

        const O = (o)=>expect.objectContaining(o)
        const mockUpload= (success,error?) =>{

            return async (connectedApp:string,observer:Observer):Promise<boolean> => {
                if (observer)
                    observer.emit('upload',{status:'started',connectedApp})
    
                await waitNextTick()
                if (observer) {
                    observer.emit('upload',{status:'done',connectedApp,success,error})
                }
                return success                    
            }
            
        }
        
        beforeEach( async ()=>{
            service = new ActivityListService()

            const db = new RepoMockClass({cntEntries:5,repoDelay:100})
            db.activities[1].details = clone(SampleDetails) as unknown as ActivityDetails    
            const selected = db.activities[1]
            setupMocks({repo:db.mock,initialized:true,listOpened:true,selected})
        })

        afterEach( ()=>{
            cleanupMocks()
            service.reset()            
        })


        test('successfull upload',async ()=>{
            const target = service.getSelected()
            const route:Partial<RouteInfo> = {
                title:'TITLE',
                id:'123',
            }
            
            target.upload = jest.fn(mockUpload(true) )
            const observer = service.getObserver()
            const updatedSpy = jest.fn()
            observer.on('updated',updatedSpy)

            const success = await service.upload('strava')
            expect(success).toBe(true)
            expect(target.upload).toHaveBeenCalledWith('strava',expect.any(Observer))
            expect(updatedSpy).toHaveBeenCalledTimes(2)            
        })    

        test('upload fails',async ()=>{
            const target = service.getSelected()
            const route:Partial<RouteInfo> = {
                title:'TITLE',
                id:'123',
            }
            
            target.upload = jest.fn(mockUpload(false,'XXX') )
            const observer = service.getObserver()
            const updatedSpy = jest.fn()
            observer.on('updated',updatedSpy)

            const success = await service.upload('strava')
            expect(success).toBe(false)
            expect(target.upload).toHaveBeenCalledWith('strava',expect.any(Observer))
            expect(updatedSpy).toHaveBeenCalledTimes(2)            
        })    
    })    



    describe('openRoute',()=>{

        const O = (o)=>expect.objectContaining(o)
        
        beforeEach( async ()=>{
            service = new ActivityListService()
            const  mocks = setupMocks({})
        })

        afterEach( ()=>{
            cleanupMocks()
            service.reset()
        })


        test('normal ',async ()=>{

            const startSettings = {startPos:6900, realityFactor:100, type:'Video', showPrev:true}
            
            service.getSelected = jest.fn().mockReturnValue( {
                createStartSettings:jest.fn().mockReturnValue(startSettings),
                getRouteCard:jest.fn().mockReturnValue({                    
                    changeSettings: jest.fn(),
                    start:jest.fn(),
                    getCardType:jest.fn().mockReturnValue('Video')
                })
            })

            const card = service.openRoute()
            expect(card).not.toBeNull()
            expect(card.changeSettings).toHaveBeenCalledWith(O(startSettings))
        })

        test('no route selected ',async ()=>{

            
            service.getSelected = jest.fn().mockReturnValue(null)

            const card = service.openRoute()
            expect(card).toBeNull()
            
        })


    })

    describe('delete',()=>{
        beforeEach( async ()=>{
            service = new ActivityListService()
        })

        afterEach( ()=>{
            cleanupMocks()
            service.reset()
        })

        test('delete from list successfull',async ()=>{
            const mocks = setupMocks({repo:RepoMock({cntEntries:5})})
            await service.preload().wait()
            service.openList()

            let updated:ActivityListDisplayProperties = {}

            
            const updatedSpy = jest.fn( (data) => {
                updated = data
            })

            const observer = service.getObserver()
            observer.on('updated',updatedSpy)
            const success =  await service.delete('activity-1')
            expect(success).toBe(true)


            expect(updatedSpy).toHaveBeenCalledTimes(1)
            expect(updated.activities?.length).toBe(4)
            expect(updated.loading).toBe(false)
          
        })

        test('delete successfull',async ()=>{
            const mocks = setupMocks({repo:RepoMock({cntEntries:5})})
            await service.preload().wait()
            service.openSelected()
            let updated:ActivityListDisplayProperties = {}

            
            const updatedSpy = jest.fn( (data) => {
                updated = data
            })

            const observer = service.getObserver()
            observer.on('updated',updatedSpy)
            const success =  await service.delete('activity-1')
            expect(success).toBe(true)


            expect(updatedSpy).not.toHaveBeenCalled()
          
        })

        test('delete error',async ()=>{
            const mocks = setupMocks({repo:RepoMock({cntEntries:5, deleteError:'XXX'})})
            await service.preload().wait()

            let updated:ActivityListDisplayProperties = {}

            
            const updatedSpy = jest.fn( (data) => {
                updated = data
            })

            const observer = service.getObserver()
            observer.on('updated',updatedSpy)

            const success =  await service.delete('activity-1')
            expect(success).toBe(false)


            expect(updatedSpy).not.toHaveBeenCalled()
            expect(spyLog).toHaveBeenCalledWith(expect.objectContaining({message:'Error',error:'XXX',fn:'delete'}))
            
            
          
        })

        describe('getPastActivitiesWithDetails',()=>{
            beforeEach( async ()=>{
                service = new ActivityListService()
            })
    
            afterEach( ()=>{
                cleanupMocks()
                service.reset()
            })
    
            test('normal',async ()=>{
    
                const searchFn = (filter,activities) => {
                    return activities.filter( (a,idx) => idx===1 || idx===3)
                }
                const db = new RepoMockClass({cntEntries:5,searchFn})                                
                setupMocks({repo:db.mock,initialized:true,listOpened:true})
  
                const activities = await service.getPastActivitiesWithDetails({
                    routeId:'route-1',
                    startPos:6900,
                    realityFactor:100
                })
                expect(activities.length).toBe(2)
                expect(activities[0].summary.id).toBe('activity-1')
                expect(activities[0].details).toBeDefined()
                expect(activities[1].summary.id).toBe('activity-3')
                expect(activities[1].details).toBeDefined()
            })

            test('details could not be loaded',async ()=>{
    
                const searchFn = (filter,activities) => {
                    return activities.filter( (a,idx) => idx===4)
                }
                const db = new RepoMockClass({cntEntries:5,searchFn,getDetailsError:'XXX'})                                
                setupMocks({repo:db.mock,initialized:true,listOpened:true})
  
                const activities = await service.getPastActivitiesWithDetails({
                    routeId:'route-1',
                    startPos:6900,
                    realityFactor:100
                })
                expect(activities.length).toBe(0)
            })


        })




    })

})