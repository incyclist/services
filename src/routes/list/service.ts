import {Page, IRouteListBinding, InternalRouteListState, List, RouteInfo, Route, RouteListEntry, RouteListStartProps, RouteListData, RouteStartSettings } from "./types";
import IncyclistRoutesApi from "../base/api";
import { RouteApiDescription, RouteApiDetail } from "../base/api/types";
import { getLocalizedData } from "../base/utils/localization";
import { IncyclistService } from "../../base/service";
import { checkIsLoop, getSegments } from "../base/utils/route";
import { useUserSettings } from "../../settings";

type filterFn = (route:Route,idx:number,obj:Route[])=>boolean

export class RouteListService  extends IncyclistService{ 

    protected static _instance

    static getInstance(binding?:IRouteListBinding):RouteListService{
        if (!RouteListService._instance) 
            RouteListService._instance = new RouteListService(binding)
        
        return RouteListService._instance
    }

    protected baseDir:string;
    protected state: InternalRouteListState
    protected binding: IRouteListBinding
    protected routes: Array<RouteListEntry>

    protected api: IncyclistRoutesApi 

    constructor( binding?:IRouteListBinding) {
        super('RouteList')

        this.state = {
            initialized: false,
            pages:[]
        }

        this.setBinding(binding)
        this.api = IncyclistRoutesApi.getInstance()
        
        this.initRouteLists()

    }


    setBinding( binding:IRouteListBinding ) {
        if(!binding)
            return;

        this.binding = binding
        this.state.initialized = true;        
    }


    async preload( carouselSize:number=5 ): Promise<void> {
        if (this.state.loading)
            await this.state.loading.promise

        const promise = this._preload(carouselSize)

        this.state.loading = {promise}
        await promise
        this.state.loading = null

    }

    protected async _preload( carouselSize:number=5, detailsOnly=false ): Promise<void> {
        
        this.logEvent( {message:'preloading routes --'})

        if (!detailsOnly) {
            await this.loadRouteDescriptions()
        }
        
        const promises = []
        this.routes.forEach( rle=> {
            if (rle.routes?.length>0) {

                    
                this.sort(rle.routes)

                rle.routes.forEach ( (r,idx)=> {


                    if (idx< Math.min(carouselSize,rle.routes.length)) {
                        const loader = this.loadRouteDetais(r)
                        promises.push(loader)
                    }
                })
                
            }
        })

        await Promise.allSettled( promises)
        this.emitPageUpdate()
        this.logEvent( {message:'preloading routes finished'})
        
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
            lists = this.routes.map( rle=>rle.list)

        
        lists.forEach( l=> {
            const routes = this.getRouteList(l)
            for (let i=loadFrom; i<loadTo;i++) {
                this.loadRouteDetais(routes[i])
            }
        })

    }

    openRouteSelection( pageId:string, props: RouteListStartProps) {
        const {language,visibleCards,visibleLists}  = props
        this.logEvent({message:'start', pageId,language,visibleCards,visibleLists })
        const existing = this.getPage(pageId)
        if (existing) {
            this.closeRouteSelection(pageId)
        }

        this.stopAllRides()

        if (props.visibleCards) {
            this._preload(props.visibleCards,true )
        }
        
        const page = this.registerPage(pageId,props)
        return page.state       
    }

    /*
    updateView( pageId:string, list:string, start:number,cntVisible:number ) {

    }
    */

    closeRouteSelection(listId:string): void {
        const idx = this.getPage(listId,true) as number
        if (idx!==-1) {
            this.state.pages.splice(idx,1)
        }        
    }

    

    openStartSettings(  r: RouteInfo|string ):RouteStartSettings {
        const route = this.getRouteFromStartProps(r);

        try {
            if (!route)
                return {}

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

        
        const route = this.getRouteFromStartProps(r);
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
        }
        catch(err) {
            this.logError( err,'acceptStartSettings',{info:{id:route?.id,title:route?.data?.title}})
            return {}

        }
    } 

    getSelectedRoute ():RouteApiDetail {
        const route =this.getRoute( v=>v.startState==='selected')
        return route?.details
    }

    getStartSettings (routeId?:string):RouteStartSettings {

        const route = routeId ? this.getRoute(routeId) : this.getRoute(v=>v.startState==='selected')

        return route?.startSettings

    }

    

    startRide(r?: RouteInfo|string ) {
        
        const route = r? this.getRoute( v=>v.startState==='selected'): this.getRouteFromStartProps(r);
        try {
          
            route.startState = 'started'
            // TODO: save settings in RouteRepo
        }
        catch(err) {
            this.logError( err,'startRide',{info:{id:route?.id,title:route?.data?.title}})
            return {}

        }

        // TBD: if/how to process updates so that we can store last position (e.g. once a minute)
    } 

    

    stopRide(r?: RouteInfo|string ) {

        const route = r? this.getRoute( v=>v.startState==='selected'): this.getRouteFromStartProps(r);
        try {
          
            route.startState = 'idle'
            // TODO: save settings in RouteRepo
        }
        catch(err) {
            this.logError( err,'stopRide',{info:{id:route?.id,title:route?.data?.title}})
            return {}

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
        return { startPos, realityFactor, segment };
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
            const state = this.getPageState(p.id)
            p.onStatusUpdate( state)
        })
    }

    protected initRouteLists() {
        this.routes = []
        this.routes.push( {list:"myRoutes", routes:[]})
        this.routes.push( {list:"selected", routes:[]})
        this.routes.push( {list:"alternatives", routes:[]})
    }


    protected getPageState(pageId:string, lang?:string) {
        const lists = []
        const state:RouteListData = { pageId,lists}

        
        const language = lang || (this.getPage(pageId) as Page)?.language || 'en'
        const add = (list:List, listHeader:string) => {


            const data = this.getRouteList(list)
            
            if (data?.length>0) {
                lists.push(this.getRouteListDataEntry(list,data, language,listHeader))           
           }
   
        }

        add('myRoutes','My Routes');
        add('selected', 'Selected For Me');
        add('alternatives', 'Alternatives');

        return state

    }

    protected registerPage(pageId:string, props:RouteListStartProps):Page {
        const {onStatusUpdate,language='en'} = props

        const state = this.getPageState(pageId,language)
        const page = { id:pageId,onStatusUpdate,language,state}

       
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
        local.points = details.points
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



    protected convertDescription( descr:RouteApiDescription): RouteInfo {
        const { id,title,localizedTitle,country,distance,elevation, category,provider, video, points} = descr
        
        const data:RouteInfo = { state:'prepared', id,title,localizedTitle,country,distance,elevation,provider,category}

        data.hasVideo = false;
        data.hasGpx = false;

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
            list = description.private ? 'myRoutes' : 'selected'
            return list
        }

        if (description.type==='video') {
            if (description.video?.url) {
                return 'selected'
            }
            //console.log( description.title,description.video)
        }
        return 'alternatives'
    }

    protected addRouteToList(list:List,route:Route) {
        this.getRouteList(list)?.push(route)
    }
    protected getRouteList(list:List):Array<Route> {
        return this.routes.find( rle=> rle.list===list)?.routes
    }

    protected getRoute(criteria:string|filterFn ):Route {

        let compareFn = criteria as filterFn
        if (typeof criteria ==='string')
            compareFn = v=> v.id===criteria 

        const lists = this.routes
        let route = null;

        for (let i=0; i<lists.length && !route;i++) {
            route = lists[i].routes.find(compareFn)
        }
        return route;

    }

    protected stopAllRides() {
        const lists = this.routes

        for (let i=0; i<lists.length;i++) {
            lists[i].routes.forEach( r => r.startState='idle')
        }
        
    }
    

    protected addDescriptions( descriptions: Array<RouteApiDescription>) {
        const converted: Array<RouteInfo> = descriptions.map(this.convertDescription.bind(this))  
        

        converted.forEach( (data,idx)=> {
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
                const item:Route = { id:data.id, data}                
                this.addRouteToList(list,item)
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

    protected async loadRouteDescriptions() {
        
        const enrich = (v:RouteApiDescription,type)=> ({type, ...v })

        const promises = [
            this.api.getRouteDescriptions({type:'gpx'}).then( v=> v.map(e=>enrich(e,'gpx'))) ,
            this.api.getRouteDescriptions({type:'video'}).then( v=> v.map(e=>enrich(e,'video')))
        ]

        const res = await Promise.allSettled( promises);

        res.forEach( p  => {
            
            if (p.status==='fulfilled') {
                this.addDescriptions( p.value)
            }    
        })

        
        
    }

    protected async loadRouteDetais(route:Route) {

        if (route.data.state==='loaded')
            return

        try {
            route.data.state = 'loading'
            route.details = await this.api.getRouteDetails(route.id)
            
            this.mergeWithDetails( route)
            route.data.state = 'loading'

            this.emitRouteUpdated(route)
        }
        catch(e) {
            route.data.state = 'error'   
        }
    }

    protected emitRouteUpdated(route:Route) {
        this.emit('route-update', route.id, route.data)
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

    
   
}


export const useRouteList = () => RouteListService.getInstance()

