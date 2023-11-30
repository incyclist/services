import {Page,  InternalRouteListState, List, RouteInfo, Route, RouteListEntry, RouteListStartProps, RouteListData, RouteStartSettings, onRouteStatusUpdateCallback, onCarouselStateChangedCallback, RoutesDB, RouteDBEntry, FreeRideSettings, CardType } from "./types";
import IncyclistRoutesApi from "../base/api";
import { RouteApiDescription, RouteApiDetail } from "../base/api/types";
import { getLocalizedData } from "../base/utils/localization";
import { IncyclistService } from "../../base/service";
import { checkIsLoop, getSegments } from "../base/utils/route";
import { useUserSettings } from "../../settings";
import { FileInfo, IFileLoader, IJsonRepositoryBinding,  JsonRepository } from "../../api";
import clone from "../../utils/clone";
import { FreeRideCard } from "./FreeRideCard";
import { ImportCard } from "./ImportCard";
import { LatLng } from "../../utils/geo";
import { geo } from "../../utils";
import { useParsers } from "../base/parsers";
import path, { IPathBinding } from "../../api/path";

type filterFn = (route:Route,idx:number,obj:Route[])=>boolean

export class RouteListService  extends IncyclistService{ 

    protected static _instance

    static getInstance():RouteListService{
        if (!RouteListService._instance) 
            RouteListService._instance = new RouteListService()
        
        return RouteListService._instance
    }

    protected baseDir:string;
    protected state: InternalRouteListState
    protected lists: Array<RouteListEntry>
    protected videosRepo: JsonRepository
    protected routesRepo: JsonRepository
    protected api: IncyclistRoutesApi 
    protected routeDescriptions: RoutesDB
    protected loader:IFileLoader
    

    constructor() {
        super('RouteList')

        this.state = {
            initialized: false,
            pages:[],
            preloadDone:false
        }
        
        this.api = IncyclistRoutesApi.getInstance()
        
        this.initRouteLists()
        this.routeDescriptions = {}

    }


    initBindings( bindings: {
                path?:IPathBinding,
                db:IJsonRepositoryBinding,
                loader?:IFileLoader}
             ) {

        console.log('~~~ initBindings',bindings)

        if (bindings.db)
            JsonRepository.setBinding(bindings.db)
        if (bindings.path)
            path.initBinding(bindings.path)
        if (bindings.loader)
            this.loader = bindings.loader;

        this.state.initialized = true;        
    }

    
    

    protected getVideosRepo():JsonRepository {
        if (this.videosRepo)
            return this.videosRepo
        this.videosRepo = JsonRepository.create('videos')
        return this.videosRepo
    }
    protected getRoutesRepo():JsonRepository {
        if (this.routesRepo)
            return this.routesRepo
        this.routesRepo = JsonRepository.create('routes')
        return this.routesRepo
    }


    async preload( carouselSize:number=5 ): Promise<void> {

        if (this.state.loading || this.state.preloadDone)
            return

        const promise = this._preload(carouselSize)

        this.state.loading = {promise}
        await promise
        this.state.preloadDone = true;
        this.state.loading = null

    }



    async load( props:{list?:List, loadFrom?:number, loadTo?:number, routeId?:string}) {

        const {routeId,list,loadFrom,loadTo} = props;

        if (routeId) {
            const route = this.getRoute(routeId)
            this.loadRouteDetais(route)
            return;
        }

        let lists = []
        if (list) 
            lists.push(list)
        else 
            lists = this.lists.map( rle=>rle.list)

        
        lists.forEach( l=> {
            const routes = this.getRouteList(l)
            for (let i=loadFrom; i<loadTo;i++) {
                this.loadRouteDetais(routes[i])
            }
        })

    }

    openRouteSelection( pageId:string, props: RouteListStartProps) {
        const {language,visibleCards,visibleLists}  = props
        this.logEvent({message:'openRouteSelection', pageId,language,visibleCards,visibleLists })


        const existing = this.getPage(pageId)
        if (existing) {
            this.closeRouteSelection(pageId)
        }

        this.stopAllRides()

        const page = this.registerPage(pageId,props)

        if (!this.state.preloadDone)
            this.preload(props.visibleCards||5)
        else 
            this.onResize(pageId)
        
        return page.state       
    }

    closeRouteSelection(pageId:string): void {
        const idx = this.getPage(pageId,true) as number
        if (idx!==-1) {
            this.state.pages.splice(idx,1)
        }        
    }

    onResize(pageId:string) {
        const page:Page = this.getPage(pageId) as Page

        //page.state.lists.forEach(list => list.)
        const routeIds = Object.keys( page.onCarouselStateChanged)
        routeIds.forEach( id=> {

            const route = this.getRoute(id)

            const stateChange = page.onCarouselStateChanged[id]?.onCarouselStateChanged
            if (stateChange)
                stateChange({initialized:true,visible:false})

            const update =page.onRouteUpdate[id].onRouteStateChanged
            if (update)
                update(route.data)
        })
        

    }

    

    openStartSettings(  r: RouteInfo|string ):RouteStartSettings {

        console.log('~~~ open start settings', r)

        const route = this.getRouteFromStartProps(r);
        try {
            if (!route)
                return {}

            this.state.selectedType = 'route'
            let startSettings = route.startSettings;

            this.stopRide();
            
            if (!startSettings){
                // get previous ride settings ( initially from User Settings, should be moved into RouteRepoDetails)
                // --> if already in state: get these from state
                startSettings = this.loadStartSettingsFromUserSettings(route);
            
            }
            route.startState = 'preparing'
    
            // Later: get previous activities of this route (from Activity-Service <to be developed>)
            // to check: what happens on screen size change 
    
            return startSettings;
    
        }
        catch(err) {
            this.logError( err,'openStartSettings',{info:{id:route?.id,title:route?.data?.title}})
            return {}
        }
    }



    cancelStartSettings(r: RouteInfo|string ) {

        // we don't need to to anything
        // mark route as available in state (keeping the settings such as segment,... for next call to openStartSettings )

        delete this.state.selectedType

        const route = this.getRouteFromStartProps(r);
        if (!route)
            return;

        console.log('~~~ cancel start settings', r)

        try {

            route.startState = 'idle'
            return 
        }
        catch(err) {
            this.logError( err,'cancelStartSettings',{info:{id:route?.id,title:route?.data?.title}})
            return {}

        }

    } 

    acceptStartSettings(r: RouteInfo|string, startSettings:RouteStartSettings) {

        // mark route as selected
        const route = this.getRouteFromStartProps(r);
        try {

            this.writeStartSettings(route, startSettings)
            route.startState = 'selected'
            route.startSettings = {...startSettings}
            this.state.selectedType='route'
        }
        catch(err) {
            this.logError( err,'acceptStartSettings',{info:{id:route?.id,title:route?.data?.title}})
            return {}

        }
    } 

    openFreeRideSettings():FreeRideSettings {
        this.state.selectedType = 'free-ride'

        try {

            this.stopRide();
            
            const settings = this.loadFreeRideSettingsFromUserSettings();
            
    
            // Later: get previous activities of this route (from Activity-Service <to be developed>)
            // to check: what happens on screen size change 
    
            return settings;
    
        }
        catch(err) {
            this.logError( err,'openFreeRideSettings')
            return {}
        }
    }



    cancelFreeRideSettings() {
        delete this.state.selectedType
        delete this.state.selectedPosition
        delete this.state.selectedOptions

        // we don't need to to anything
        // mark route as available in state (keeping the settings such as segment,... for next call to openStartSettings )
    } 

    changeFreeRideSettings(props:{position:LatLng}) {
        const {position: pos} = props;

        const position = geo.getLatLng(pos)
        this.state.selectedPosition = position
        this.writeFreeRideSettingsToUserSettings( position);

    } 

    acceptFreeRideSettings(options) {

        this.state.selectedOptions = options
        this.state.selectedType = 'free-ride'
        // mark route as selected
    
        /*
        try {

            this.writeStartSettings(route, startSettings)
            route.startState = 'selected'
        }
        catch(err) {
            this.logError( err,'acceptStartSettings',{info:{id:route?.id,title:route?.data?.title}})
            return {}

        }
        */
    } 


    import( pageId,files:Array<FileInfo>) {
        console.log('~~~ import ', pageId, files)

        const page = this.getPage(pageId) as Page
        console.log('~~~ import ', files,page)

        const parsers = useParsers() 
        
            files.forEach( async (file)=>{
                try {
                    const {data,error} = await this.loader.open(file)
                    if (error) {
                        //TODO
                        return;
                    }

                    console.log('~~~ DATA',data)
                    const parser = parsers.findMatching( file.ext, data)
                    const route = parser.import(data)
                    console.log('~~~ ROUTE',route)
                }
                catch(err) {
                    console.log(err)
                }
    
        })

        
        const route:Route= {
            id:Date.now().toString(),
            data: {
                type:'route',
                id:Date.now().toString(),
                state:'prepared',
                title:'Test'
            }


        }
        this.addRouteToList('myRoutes',route)

        /*
            let status = []
            this.files.forEach( async(info)=>{
                const res = this.fileLoader.processSingle(f)
                if (res.error) { 
                    //
                    status.push( {info,error})
                }
                if (res.data)
                    const {error,route} = importRoute(info,data)
                    status.push( {info,error})
                    if (!error) {
                        this.addRouteToList('myRoutes',route)
                    }

            })
        */

        //page.state?.lists[0]?.routes.push(route)
        this.emitPageUpdate()
    }

    /*
    protected importRoute(info,data) {

    }
    */

    

    setCardUpdateHandler(pageId:string,r: RouteInfo|string,list:List,idx:number, onRouteStateChanged:onRouteStatusUpdateCallback,onCarouselStateChanged:onCarouselStateChangedCallback ) {
        const route = this.getRouteFromStartProps(r);
        if (!route)
            return;

        const page = this.getPage(pageId) as Page
        if(!page)   
            return;

        
        
        page.onRouteUpdate[route.id] ={idx,onRouteStateChanged}
        page.onCarouselStateChanged[route.id] = {idx,onCarouselStateChanged}
        
        
    }

    onCarouselInitialized(pageId:string, list:List,startIdx:number, visibleSize:number) {
        
        const page = this.getPage(pageId) as Page
        if(!page)   
            return;

        const listState = this.getListState(page,list)
        if (listState) {
            listState.startIdx = startIdx;
            listState.endIdx = startIdx+visibleSize-1;
        }
        

        const routes = this.getRouteList(list)
        routes.forEach( (route) => {
            
            const {idx,onCarouselStateChanged} = page.onCarouselStateChanged[route.id]||{}
            const visible = listState!==undefined ? idx>=listState.startIdx &&idx<=listState.endIdx : undefined

            if (onCarouselStateChanged)
                onCarouselStateChanged({initialized:true,visible})


            if (visible && (route.data.state==='prepared' || route.data.state==='error')) {
                this.loadRouteDetais(route)
            }
        })
    }

    onCarouselUpdated(pageId:string, list:List,startIdx:number, visibleSize:number) {
        const page = this.getPage(pageId) as Page
        if(!page)   
            return;

        const listState = this.getListState(page,list)
        if (listState) {
            listState.startIdx = startIdx;
            listState.endIdx = startIdx+visibleSize-1;
        }
        

        const routes = this.getRouteList(list)
        routes.forEach( (route) => {
            
            const {idx,onCarouselStateChanged} = page.onCarouselStateChanged[route.id]||{}

            const visible = listState!==undefined ? idx>=listState.startIdx &&idx<=listState.endIdx : undefined
            if (onCarouselStateChanged)
                onCarouselStateChanged({initialized:true,visible})

            if (visible && route.data.state==='prepared' || route.data.state==='error') {
                this.loadRouteDetais(route)
            }
        })
    }


    getSelectedRoute ():RouteApiDetail {
        const route =this.getRoute( v=>v.startState==='selected')
        return route?.details
    }


    getStartSettings (routeId?:string):RouteStartSettings {
        console.log('~~ getStartSettings', this.state)

        switch ( this.state.selectedType) {
            case 'free-ride':
                return { type:'free-ride', options:this.state.selectedOptions, position: this.state.selectedPosition}
                break;
            case 'route': {
                const route = routeId ? this.getRoute(routeId) : this.getRoute(v=>v.startState==='selected')
                if (route)
                    return {type:'route',...route.startSettings}
                }
                break
            default:
                return;
        }


    }

    

    startRide(r?: RouteInfo|string ) {

        if (this.state.selectedType==='route') {
        
            const route = r? this.getRoute( v=>v.startState==='selected'): this.getRouteFromStartProps(r);
            try {
            
                route.startState = 'started'
                // TODO: save settings in RouteRepo
            }
            catch(err) {
                this.logError( err,'startRide',{info:{id:route?.id,title:route?.data?.title}})
                return {}

            }
        }
        // TBD: if/how to process updates so that we can store last position (e.g. once a minute)
    } 

    

    stopRide(r?: RouteInfo|string ) {
        delete this.state.selectedType

        const route = r? this.getRoute( v=>v.startState==='selected'): this.getRouteFromStartProps(r);
        if (!route)
            return;

        try {
          
            route.startState = 'idle'
            // TODO: save settings in RouteRepo
        }
        catch(err) {
            this.logError( err,'stopRide',{info:{id:route?.id,title:route?.data?.title}})
        }

        // save last position
    } 

    startDownload(routeId, onStatusUpdate) {
        // also update RouteData (so that status can be rendered in carousel)
        // queue downloads (max one at a time)

        // onFinished: update RouteData & RouteDetails, store in Repo, update RouteList state -> should trigger re-render of carousel
    }

    cancelDownload(routeId) {

    }

    

    protected async _preload( carouselSize:number=5, detailsOnly=false ): Promise<void> {
        
        if (!detailsOnly) {
            await this.loadRouteDescriptions()
        }
        this.emitPageUpdate()
        

         
        const lists = this.getRouteLists().map(li=>li.list)
        lists.forEach( (list)=>{ 
            this.preloadList(list,carouselSize)
        })
        
       

        this.logEvent( {message:'preloading routes finished'})
        
    }

    protected async preloadList( list:List, carouselSize:number=5 ): Promise<void> {
       
       
        this.emitPageUpdate()

        
        const promises = []
        
        const rle = this.lists.find(l=>l.list===list)
            if (rle.routes?.length>0) {

                    
                this.sort(rle.routes)
                let cntApi = 0;
                rle.routes.forEach ( (r)=> {
                    if (!r.data.isLocal){
                        cntApi++;
                    }

                    if (r.data.isLocal || cntApi<= Math.min(carouselSize,rle.routes.length)) {
                        promises.push( this.loadRouteDetais(r))
                        
                        
                    }
                })
            
            }
        

        console.log( '~~~ DEBUG: during preload',promises.length)        
        Promise.allSettled(promises).then( (res)=>{
            console.log( '~~~ DEBUG: after preload',clone(this.state), clone(this.routeDescriptions),res)
            this.saveRouteDescriptions()

        })
        

    }
    protected loadStartSettingsFromUserSettings( route: Route) {
        let startPos = 0, realityFactor = 100, segment;
        const {data} = route

        const routeType = data.hasVideo ? 'video' : 'followRoute';
        // TODO: FreeRide
        const prevSetting = this.getUserSetting(`routeSelection.${routeType}`, null);
        if (prevSetting) {
            startPos = prevSetting.startPos;
            realityFactor = prevSetting.reality;
        }

        const prevRouteSetting = this.getUserSetting(`routeSelection.${routeType}.prevSettings.${route.id}`, null);
        if (prevRouteSetting) {
            startPos = prevRouteSetting.startPos;
            realityFactor = prevRouteSetting.reality;
            segment = prevRouteSetting.segment
        }

        const prevRoutePosition = this.getUserSetting(`position.${route.id}`, null);
        if (prevRoutePosition !== null) {
            startPos = prevRoutePosition;
        }

        if (data.videoFormat==='avi') {
            startPos = 0;
            segment = undefined
        }
        return { startPos, realityFactor, segment };
    }

    protected loadFreeRideSettingsFromUserSettings() {

        let position:LatLng
        const prevSetting = this.getUserSetting(`routeSelection.freeRide`, null);
        if (prevSetting) {
            position = prevSetting.position;
        }
        else {
            position = this.getUserSetting(`position`, null);    
        }

        return { position };
    }

    protected writeFreeRideSettingsToUserSettings(position:LatLng) { 
        const userSettings = useUserSettings()

        userSettings.set('routeSelection.freeRide',{position})
    }

    protected writeStartSettingsToUserSettings(route:Route, startSettings:RouteStartSettings) {
        const routeId = route.id
        const userSettings = useUserSettings()
        const {startPos,realityFactor,segment} = startSettings

        // update Position
        userSettings.set(`position.${routeId}`,startPos)

        // Type Settings
        const routeType = route?.data?.hasVideo ? 'video' : 'followRoute'
        userSettings.set(`routeSelection.${routeType}.startPos`,startPos)
        userSettings.set(`routeSelection.${routeType}.reality`,realityFactor)
        userSettings.set(`routeSelection.${routeType}.segment`,segment)

        // Route Settings
        userSettings.set(`routeSelection.${routeType}.prevSettings.${route.id}`,{startPos, reality:realityFactor,segment})

    }
    
    protected writeStartSettings(route:Route, startSettings:RouteStartSettings) {
        this.writeStartSettingsToUserSettings(route,startSettings)
    }

    protected getUserSetting(key:string,defValue?) {
        try {
            const userSettings = useUserSettings();

            const res = userSettings.get(key,defValue)
            return res
        }
        catch (err) {
            return defValue
        }
    }


    protected emitPageUpdate() {
        
        this.state.pages.forEach( p=> {
            p.state = this.getPageState(p.id)
            p.onStatusUpdate( p.state)
        })
    }

    protected initRouteLists() {
        this.lists = []
        this.lists.push( {list:"myRoutes", routes:[]})
        this.lists.push( {list:"selected", routes:[]})
        this.lists.push( {list:"alternatives", routes:[]})
    }


    protected getPageState(pageId:string, lang?:string) {
        const lists = []
        
        const state:RouteListData = { pageId,lists}

        
        const language = lang || (this.getPage(pageId) as Page)?.language || 'en'

        const add = (list:List, listHeader:string) => {


            const data = this.getRouteList(list)

            if (list==='myRoutes' && !data.find( r=> r.data.type==='free-ride')) {
                
                const card:FreeRideCard = new FreeRideCard('loaded') as RouteInfo
                const route:Route = {data:card,id:'free-ride',}

                data.unshift( route)
            }

            if (list==='myRoutes' && !data.find( r=> r.data.type==='import')) {
                
                const card:ImportCard = new ImportCard('loaded') as RouteInfo
                const route:Route = {data:card,id:'import',}

                data.unshift( route)
            }

            
            if (data?.length>0) {
                lists.push(this.getRouteListDataEntry(list,data, language,listHeader))           
           }
   
        }

        add('myRoutes','My Routes');
        add('selected', 'Selected For Me');
        add('alternatives', 'Alternatives');


        console.log('~~~ DEBUG:getPageState',state)

        return state

    }

    protected registerPage(pageId:string, props:RouteListStartProps):Page {
        const {onStatusUpdate,language='en'} = props

        const state = this.getPageState(pageId,language)
        const page = { id:pageId,onStatusUpdate,onRouteUpdate:{},onCarouselStateChanged:{},language,state}

       
        this.state.pages.push(page)
        return page
    }

    protected sort(routes:RouteInfo[]| Route[]) {

        const isRouteArray = (a) => a[0].data!==undefined

        let val = (route)=>route
        if (isRouteArray(routes)){
            val = (route)=>route.data            
        }
        
        const score = (route: RouteInfo) =>{
            let val = 0;
            if (route.hasVideo) val+=1000;
            if (route.hasGpx) val+=100
            if (route.isDemo) val-=150
            return val;
        }
        

        routes.sort( (a,b) => score(val(b))-score(val(a)) )

    }
    protected getRouteListDataEntry(list:List, entry:Array<Route>, language:string, listHeader:string) {
        const routes = entry.map( r => getLocalizedData(r.data,language))
        this.sort(routes)
        return {list,listHeader,routes}
    }


    protected getPage(pageId:string, byIndex?:boolean):Page|undefined|number {
        if (byIndex)
            return this.state.pages.findIndex (c=> c.id===pageId)    

        return this.state.pages.find (c=> c.id===pageId)
    }

    protected getRouteDescription(list: List, id:string):RouteInfo {
        return this.getRouteList(list)?.find( ri=>ri.id===id)?.data
    }


    protected mergeDescription( local:RouteInfo, fromApi:RouteInfo ) {
        // don't overwrite local state
        const {state} = local 
        Object.assign(local, {...fromApi})
        local.state = state;        
    }

    protected mergeWithDetails( route:Route ):void { 
        
        const local = {...route.data}
        const {details} = route
        
        local.country = local.country || details.country
        local.distance = local.distance || details.distance
        local.elevation = local.elevation || details.elevation
        local.localizedTitle = local.localizedTitle || details.localizedTitle
        if (!local.points) {
            local.points = details.points
        }
        if (!local.hasGpx && details.points) {
            local.hasGpx = true;          
        }
        if (local.isLoop===undefined && details.points)
            local.isLoop = checkIsLoop(route)
        if (!local.segments) {
            local.segments = getSegments(route) || []
            local.segments = local.segments.filter( s=>s.start>0 && s.end<local.distance)
        }

        

        const {video} = details
        if (video) {
            local.hasVideo = true;
            local.videoFormat = video.format
            if (video.url && !local.videoUrl) {
                local.requiresDownload = false;
                local.videoUrl = video.url
            }
        }

        if (details.downloadUrl && details.downloadType==='mp4' && !local.videoUrl) {
            local.videoUrl = details.downloadUrl
            local.requiresDownload = true;
        }

        route.data = local;
        


    }



    protected convertDescription( descr:RouteApiDescription, isLocal?:boolean): RouteInfo {
        const { id,title,localizedTitle,country,distance,elevation, category,provider, video, points} = descr
        
        const data:RouteInfo = { type:'route',state:'prepared', id,title,localizedTitle,country,distance,elevation,provider,category}

        data.hasVideo = false;
        data.hasGpx = false;
        data.isLocal = isLocal||false

        this.updateRouteCountry(data,{descr})
        this.updateRouteTitle(data,{descr})
        // Todo: previewImg (could be generated from video/streetview)

        if (points) data.hasGpx = true;

        if (category?.toLowerCase()==='demo') 
            data.isDemo = true;

        if (video) {
            data.hasVideo = true;
            if (video.format) data.videoFormat = video.format
            if (video.url && !data.videoUrl) data.videoUrl = video.url
            
        }

        return data;
    }

    protected getListFromApiDesciption(description:RouteApiDescription) {
        let list:List

        if (description.type==='gpx') {
            if (description.category==='personal')
                return 'myRoutes'

            list = description.category ? 'alternatives' : 'selected'

            return list
        }

        if (description.type==='video') {

            if (description.category===undefined || description.category==='personal')
                return 'myRoutes'
            if (description.video?.url) {
                return 'selected'
            }
        }
        return 'alternatives'
    }


    protected addRouteToList(list:List,route:Route) {
        this.getRouteList(list)?.push(route)
    }
    protected getRouteList(list:List):Array<Route> {
        return this.lists.find( rle=> rle.list===list)?.routes
    }

    protected getRouteLists():Array<{list:List,title:string}> {
        const lists:Array<{list:List,title:string}> = [
            { list:'myRoutes',title:'My Routes'},
            { list:'selected',title:'Selected For Me'},
            { list:'alternatives',title:'Alternatives'}
        ]
        return lists;
    }

    protected getRoute(criteria:string|filterFn ):Route {

        let compareFn = criteria as filterFn
        if (typeof criteria ==='string')
            compareFn = v=> v.id===criteria 

        const lists = this.lists
        let route = null;

        for (let i=0; i<lists.length && !route;i++) {
            route = lists[i].routes.find(compareFn)
        }
        return route;

    }

    protected getAllRoutes():Array<Route> {
        const lists = this.lists
        
        const routes = []

        for (let i=0; i<lists.length ;i++) {
            routes.push( ...lists[i].routes)
        }
        return routes;

    }

    protected stopAllRides() {
        const lists = this.lists

        for (let i=0; i<lists.length;i++) {
            lists[i].routes.forEach( r => r.startState='idle')
        }
        
    }


    protected addDescriptionsFromDB( descriptions: RoutesDB) {

        const ids = Object.keys(descriptions)
        const routes:Array<RouteDBEntry> = ids.map( id=> descriptions[id])
        this.routeDescriptions = descriptions

        routes.forEach( (data)=> {
            data.state = "prepared"
            this.addRouteToList(data.list, {data,id:data.id} )

        })
       
    }    

    // Legacy Routes DB
    protected addDescriptionsFromRepo( descriptions: Array<RouteApiDescription>,repo?:JsonRepository) {

        const routes = descriptions as Array<RouteApiDescription>
        if (repo) {       
            // add type information to route
            const type = repo.getName()==='videos' ? 'video' : 'gpx'       
            routes.forEach( r => {
                r.type=type
                
            })
        }
       
        const converted: Array<RouteInfo> = routes            
            .map(this.convertDescription.bind(this))  
        

        converted.forEach( (data,idx)=> {


            const  list = this.getListFromApiDesciption(descriptions[idx])    

            const existing = this.getRouteDescription(list,data.id)
            if (existing) {
                this.mergeDescription(existing,data)
            }
            else {
                data.state = 'prepared'
                data.isLocal = true;
                const item:Route = { id:data.id, data}                
                this.addRouteToList(list,item)
                this.routeDescriptions[data.id] = {...data,list};
            }

        })
       
    }


    protected addDescriptionsFromServer( descriptions: Array<RouteApiDescription>) {
        const converted: Array<RouteInfo> = descriptions.map(this.convertDescription.bind(this))  
        

        converted.forEach( (data,idx)=> {

            // is route already in any list?
            const existing = this.getRoute(data.id)
            if (existing) {
                // TODO check if needs to be updated
                return;
            }

            const  list = this.getListFromApiDesciption(descriptions[idx])    
            if (!list) {
                this.logEvent( {message:'Error', error:'no list found for route', id:data.id, title:data.title})
                return;
            }

            const local = this.getRouteDescription(list,data.id)
            if (local) {
                this.mergeDescription(local,data)
            }
            else {
                data.state = 'prepared'
                data.isLocal = false;
                const item:Route = { id:data.id, data}                
                this.addRouteToList(list,item)
                this.routeDescriptions[data.id] = {...data,list};
                this.emitPageUpdate()
            }

        })
        
    }

    protected updateRouteTitle( data: RouteInfo, route:{ descr?:RouteApiDescription}):void{
        const {descr} = route;
        if (descr && !data.title) {
            data.title = descr.title
        }
        const prefix = this.getCountryPrefix(data.title) as string
        if (prefix) {
            data.title = this.removeCountryPrefix(data.title)
        }

    }

    protected updateRouteCountry( data: RouteInfo, route:{ descr?:RouteApiDescription}):void {
        const {descr} = route;

        
        if (descr?.country && !data.country) {
            data.country = descr.country
        }
        if (data.country)
            return;

        const prefix = this.getCountryPrefix(data.title) as string
        if (prefix) {
            data.country = prefix.toLowerCase()
            return;
        }        
    }

    protected getCountryPrefix(title?:string):string|undefined {
        if (!title)
            return

        if (title.match(/^[A-z]{2}[-_].*/g)) {            
            return title.substring(0,2)
        }
    }

    protected removeCountryPrefix(title?:string):string {
        if (!title)
            return

        if (title.match(/^[A-z][A-z][-_].*/g)) {
            return title.substring(3)
        }
        
    }



    protected async loadRouteDescriptionsFromRepo() {


        if (Object.keys(this.routeDescriptions).length>0) {
            this.emitPageUpdate()
            return;
        }

        const all = await this.getRoutesRepo().read('settings')  as unknown as RoutesDB
        if (!all) {

            const videos = (await this.getVideosRepo().read('routes') || []) as unknown as Array<RouteApiDescription> 
            //const videosData = videos.map(e=>enrichRepo(e,'video'))
            this.addDescriptionsFromRepo(videos,this.getVideosRepo())

            const routes = (await this.getRoutesRepo().read('routes') ||[]) as unknown as  Array<RouteApiDescription>
            //const routesData = routes.map(e=>enrichRepo(e,'gpx'))
            this.addDescriptionsFromRepo(routes,this.getRoutesRepo())

        }
        else {
            const ids = Object.keys(all)
            ids.forEach( id=> {
                const r = all[id];
                if (typeof r.points==='string') {
                    this.decodePoints(r);
                }
                if (!Array.isArray(r.points))
                    delete r.points
            })

            console.log('~~~ DEBUG:', all)
            this.addDescriptionsFromDB(all)
            

        }
        this.saveRouteDescriptions()
        

    }

    protected async saveRouteDescriptions() {
        
        const ids = Object.keys(this.routeDescriptions)

        const data = ids.map(id => {
            const r = this.routeDescriptions[id]
            if (r.points)
                this.encodePoints(r)
            return {...r}
        })

        await this.getRoutesRepo().write('settings',data)
    }

    protected async loadRouteDescriptionsFromServer() {

        const enrichApi = (v:RouteApiDescription,type)=> ({type, ...v })
        const api = [
            this.api.getRouteDescriptions({type:'gpx'}).then( v=> v.map(e=>enrichApi(e,'gpx'))) ,
            this.api.getRouteDescriptions({type:'video'}).then( v=> v.map(e=>enrichApi(e,'video')))
        ]

        const res = await Promise.allSettled( api);
        
        res.forEach( p  => {
            
            if (p.status==='fulfilled') {
                
                this.addDescriptionsFromServer( p.value)
            }    
        })

        
        
    }



    protected async loadRouteDescriptions() {
        console.log('~~~ DEBUG:loadRouteDescriptions',Object.keys(this.routeDescriptions))
        await this.loadRouteDescriptionsFromRepo()
        this.emitPageUpdate()

        if (this.isDescriptionsLoaded()) {
            await this.loadRouteDescriptionsFromServer()    
            this.emitPageUpdate()
            this.saveRouteDescriptions()
        }
        else {
            
            this.loadRouteDescriptionsFromServer().then( ()=>{
                //console.log('~~~ DEBUG, routes after API',this.routes)
                // TODO: check for route updates on server
                this.emitPageUpdate()
            })
    
        }

        

        
    }

    protected async loadRouteDetais(route:Route) {

        //if (route.data.title==='Arnbach') {
        //}

        if (route.data.state==='loaded' || route.data.state==='loading')
            return

        try {
            route.data.state = 'loading'
            this.emitRouteUpdated(route)

            try {
                route.details =route.data.hasVideo ? 
                    await this.getVideosRepo().read(route.id) as RouteApiDetail
                    :
                    await this.getRoutesRepo().read(route.id) as RouteApiDetail
                
                IncyclistRoutesApi.verify(route.details)
            }
            catch (err) {
                console.log('~~~ DEBUG:error', route.data.title,route.data.isLocal,  err)
                if (route.data.isLocal)
                    throw err

            }        
            

            if(!route.details) {
                route.details = await this.api.getRouteDetails(route.id)
                IncyclistRoutesApi.verify(route.details)
                this.saveRouteDetails(route)
            }

            if (route.details.id!==route.data.id) {
                route.data.state = 'error'   
                delete route.details
                return;    
            }

           
            this.mergeWithDetails( route)
            route.data.state = 'loaded'

            this.emitRouteUpdated(route)
            const {list} = this.routeDescriptions[route.id]
            this.routeDescriptions[route.id] = {...route.data,list}
            return route.data
        }
        catch(e) {
            route.data.state = 'error'   
            this.emitRouteUpdated(route)
        }
    }


    async saveRouteDetails(route) {
        try {
            route.details =route.data.hasVideo ? 
                await this.videosRepo.write(route.id,route.details)
                :
                await this.routesRepo.write(route.id,route.details)                        
        }
        catch (err) {
            if (route.data.isLocal)
                throw err
        }        

    }

    protected emitRouteUpdated(route:Route) {
        this.emit('route-update', route.id, route.data)
        
        this.state.pages.forEach( page=> {
            try {
                const {onRouteStateChanged} = page.onRouteUpdate[route.id]||{}
                const {language} = page
                if (onRouteStateChanged)  {
                    const data = getLocalizedData(route.data,language)
                    onRouteStateChanged(data)
                }
            }
            catch(err) {
                console.log('~~~ DEBUG:Error',err)
            }                

        })
    }

    protected getListState( page:Page, list:List) {
        return page?.state.lists.find(pl => pl.list===list)
    }

    // TODO:

    /*
        createPreviewImageFromVideo()    
        createPreviewImageFromGPX()    
        getCountryFromGPX()


    */


    private getRouteFromStartProps(r: string | RouteInfo):Route {
        try {
            let route;
            if (typeof r === 'string') {
                route = this.getRoute(r);
            }
            else {
                const info = r as RouteInfo;
                route = this.getRoute(info.id);
            }
            return route;
        }
        catch {
            return
        }
    }

    private isDescriptionsLoaded() {
        return Object.keys(this.routeDescriptions).length===0
    }

    private decodePoints(r: RouteDBEntry) {
        return
        /*
        const before = r.points

        const pointsStr = zlib.inflateSync(Buffer.from(r.points as string, 'hex')).toString('utf8');
        r.points = JSON.parse(pointsStr)
        console.log('~~~ decoded', r.title,pointsStr,before)
        return;
        
        r.points = JSON.parse(pointsStr)
        return;
        const points = pointsStr.split('|')
            .map(p => {
                const [elevation, routeDistance, lat, lng] = p.split('/');
                return { elevation: Number(elevation), routeDistance: Number(routeDistance), lat: Number(lat), lng: Number(lng) };
            });        
        r.points = points;

        console.log('~~~ decoded', r.title,r.points)
        */
    }

    private encodePoints(r:RouteDBEntry) {
        return
        /*
        const str = JSON.stringify(r.points)
        const deflated = zlib.deflateSync(Buffer.from(str,'utf8')).toString('hex');
        r.points = deflated

        if (Array.isArray(r.points)) {

                        
            const points  = r.points.map( p=> `${p.elevation}/${p.routeDistance}/${p.lat}/${p.lng}`).join('|')        

        }
        */

    }

   
}


export const useRouteList = () => RouteListService.getInstance()

