import { FileInfo, getBindings} from "../../api";
import { CardList } from "../../base/cardlist";
import { IncyclistService } from "../../base/service";
import { Singleton } from "../../base/types";
import { PromiseObserver } from "../../base/types/observer";
import { RouteApiDetail } from "../base/api/types";
import { Route } from "../base/model/route";
import { RouteParser  } from "../base/parsers";
import { RouteInfo } from "../base/types";
import { RoutesApiLoader } from "./loaders/api";
import { RouteImportCard } from "./cards/RouteImportCard";
import { FreeRideCard } from "./cards/FreeRideCard";
import { MyRoutes } from "./lists/myroutes";
import { RouteCard, SummaryCardDisplayProps } from "./cards/RouteCard";
import { RouteStartSettings, SearchFilter, SearchFilterOptions } from "./types";
import { RoutesDbLoader } from "./loaders/db";
import { valid } from "../../utils/valid";
import { getCountries  } from "../../i18n/countries";
import { RouteListObserver } from "./RouteListObserver";
import IncyclistRoutesApi from "../base/api";


@Singleton
export class RouteListService extends IncyclistService {

    protected myRoutes: MyRoutes
    protected selectedRoutes: CardList<Route> 
    protected alternatives: CardList<Route> 
    protected routes: Array<Route>

    protected preloadObserver: PromiseObserver<void>
    protected observer: RouteListObserver

    protected initialized: boolean
    protected selectedRoute: Route
    protected startSettings: RouteStartSettings
    protected screenProps;    
    protected language
    protected api : RoutesApiLoader
    protected db: RoutesDbLoader
    protected createPreviewQueue: Array< {descr:RouteInfo,done:(file:string)=>void}>
    protected previewProcessing: PromiseObserver<void>
    protected filters: SearchFilter

    constructor () {
        super('RouteList')

        this.myRoutes = new MyRoutes('myRoutes','My Routes')
        this.selectedRoutes = new CardList<Route>('selected','Selected For Me')
        this.alternatives = new CardList<Route>('alternaties','Alternatives')
        this.initialized = false;
        this.language = 'en'
        
        this.myRoutes.add( new RouteImportCard())
        this.myRoutes.add( new FreeRideCard())
        this.api = new RoutesApiLoader()
        this.db = new RoutesDbLoader()
        this.createPreviewQueue = []
        this.routes = []
        this.filters = {}
    }


    // Getters && Setters
    setLanguage(language:string) {this.language = language}
    getLanguage():string {return this.language}
    getStartSettings():RouteStartSettings { return this.startSettings; }
    setStartSettings(settings:RouteStartSettings) { this.startSettings = settings }
    getSelected():Route { return this.selectedRoute }
    setScreenProps(props) {this.screenProps = props }
    getScreenProps() { return this.screenProps}
    

    open():RouteListObserver {
        try {
            this.logEvent( {message:'open route list'})

            const hasLists = this.getLists()?.length>0
            const emitStartEvent = async()=> {
                process.nextTick( ()=>{
    
                    this.observer?.emit('started')
                })
                
            }
            const emitLoadedEvent = async()=> {
                process.nextTick( ()=>{
                    this.emitLists('loaded')
                })
            }
            this.getLists()?.forEach( list=> {
                list.getCards()?.forEach( (card,idx) => {
                    card.setInitialized(false)
                    if (idx>0)
                        card.setVisible(false)
                })
            })
    
    
            // selection already ongoing, return existing observer
            if (!this.observer) {
                this.observer = new RouteListObserver(this)
                emitStartEvent()
            }        
    
            // if preload has not been started yet, load data
            if (!this.initialized && !this.preloadObserver) {
                this.preload()
            }
            // if we are re-opening the page, ensure that no route is selected
            else if (this.initialized ) {
                this.unselect()
            }
            
            if (this.initialized && !hasLists)
                emitLoadedEvent()
    
                
        }
        catch (err) {
            this.logError(err,'open')
        }
        return this.observer
    }



    close():void {
        try {
            this.logEvent( {message:'close route list'})
            this.observer?.emit('stopped')
            this.observer.reset()
            //delete this.observer;
    
            this.resetCards()
    
        }
        catch(err) {
            this.logError(err, 'close')
        }


    }
 
    search( filters?:SearchFilter ) {
        if (!this.initialized)
            this.preload();

        if (!this.observer)
            this.observer = new RouteListObserver(this)

        try {
            this.filters = filters||{}

            let routes:Array<SummaryCardDisplayProps> =   this.getAllCards().map( c=> c.getDisplayProperties())
    
    
            if (filters?.title && filters.title.length) {
                
                routes = routes.filter( r => r.title?.toUpperCase().includes(filters.title.toUpperCase()))
            }
    
            if (filters?.distance?.min)
                routes = routes.filter( r => r.distance>=filters?.distance?.min)
    
            if (filters?.distance?.max)
                routes = routes.filter( r => r.distance<=filters?.distance?.max)
    
            if (filters?.elevation?.min)
                routes = routes.filter( r => r.elevation>=filters?.elevation?.min)
            
            if (filters?.elevation?.max)
                routes = routes.filter( r => r.elevation<=filters?.elevation?.max)
    
            if (filters?.country) {            
                const iso = filters.country === 'Unknown' ? undefined : getCountries().getIsoFromCountry(filters.country)            
                routes = routes.filter( r => r.country===iso)
            }

            if (filters?.contentType) {            
                const video = filters.contentType===undefined|| filters.contentType==='Video'
                const gpx = filters.contentType===undefined|| filters.contentType==='GPX'
                routes = routes.filter( r => ( video && r.hasVideo) || (gpx && !r.hasVideo ) )
            }

            if (filters?.routeType) {            
                const loop = filters.routeType===undefined|| filters.routeType==='Loop'
                const p2p = filters.routeType===undefined|| filters.routeType==='Point to Point'
                routes = routes.filter( r => ( loop && r.isLoop) || (p2p && !r.isLoop ) )
            }

            return {routes,filters,observer:this.observer}
    
        }
        catch(err) {
            this.logError(err,'search')
            return {routes:[], filters:{}}

        }
    }

    stopSearch():void {        
        try {
            this.observer.reset()
        }
        catch(err) {
            this.logError(err,'stopSearch')
        }
    }

    getFilterOptions(): SearchFilterOptions {

        let countries = []
        let contentTypes = []
        let routeTypes = []

        try {
            countries = this.getFilterCountries();
            contentTypes = this.getFilterContentTypes();
            routeTypes = this.getFilterRouteTypes()
        }
        catch (err) {
            this.logError(err,'getFilterOption')
        }
        return {countries,contentTypes,routeTypes}
    }

    onResize() {
        try {
            this.resetCards()
        }
        catch(err) {
            this.logError(err,'onResize')
        }

    }

    onCarouselInitialized(list:CardList<Route> /*,item,itemsInSlide*/) {
        try {
            list.getCards().forEach( card => {
                card.setInitialized(true)
                card.setVisible(true)
            })
        }
        catch(err) {
            this.logError(err,'onCarouselInitialized')
        }
        
    }

    onCarouselUpdated(list,item,itemsInSlide) {
        console.log('~~~ UPDATED',list,item,itemsInSlide)
    }


    preload():PromiseObserver<void> {
        try {
            this.logEvent( {message:'preload route list'})
            if (!this.preloadObserver) {
                const promise = this.loadRoutes()
                this.preloadObserver = new PromiseObserver<void>( promise )
    
                this.preloadObserver.start()
                    .then( ()=> { 
                        const cards = {                        
                            myRoutes:this.myRoutes.length, 
                            selected:this.selectedRoutes.length ,
                            alternatives:this.alternatives.length
                        }
                        this.logEvent( {message:'preload route list completed',cards})
                        this.initialized = true
                        this.emitLists('loaded')
                        process.nextTick( ()=>{delete this.preloadObserver})
                    })
                    .catch( (err)=> {
                        this.logError(err,'preload')
                    })
            }
    
    
        }
        catch(err) {
            this.logError(err,'preload')
        }
        return this.preloadObserver
    }

    getLists(forUi:boolean=true):Array<CardList<Route>> {
        try {
            if (forUi && (!this.initialized))
                return null;

            const lists:Array<CardList<Route>> = [ this.myRoutes ]
            if ( this.selectedRoutes?.length>0) 
                lists.push(this.selectedRoutes)
            if ( this.alternatives?.length>0) 
                lists.push(this.alternatives)

            return lists

        }
        catch(err) {
            this.logError(err,'getLists')
            return [ this.myRoutes]
        }

    }


    async getRouteDetails(id:string):Promise<RouteApiDetail> {
        try {
            const route = this.routes.find( r => r.description.id===id)
            if (route) {
                if (route.details)
                    return route.details
                
                route.details = await this.db.getDetails(id)
                return route.details
            }
    
        }
        catch(err) {
            this.logError(err,'getRouteDetails',id)
        }
    }

    async getSelectedRouteDetails():Promise<RouteApiDetail> {
        try {
            const selected = this.getSelected()
            if (selected.details)
                return selected.details;
    
            return this.getRouteDetails(selected.description.id)
    
        }
        catch(err) {
            this.logError(err,'getSelectedRouteDetails')
        }
    }

    unselect() {
        this.selectedRoute = null    
        this.startSettings = null;
    }

    select(route:Route) {
        this.selectedRoute = route
    }

    import( info:FileInfo|Array<FileInfo>):void {
        try {
            const files = Array.isArray(info) ? info : [info]

            files.forEach( async (file)=>{
                try {
                    const {data,details} = await RouteParser.parse(file)              
    
                    const route = new Route(data,details as RouteApiDetail)
                    
                    const existing = this.findCard(route)
                    let card:RouteCard
    
                    if (existing ) {
    
                        if (existing.list.getId()===this.myRoutes.getId()) {
                            card = existing.card as RouteCard
                            card.updateRoute(route)    
                            route.description.tsImported = Date.now()
                        }
                        else {
                            existing.list.remove( existing.card)
                            card = new RouteCard(route,{list:this.myRoutes})
                            card.verify()
                            card.save()
                            card.enableDelete()
                            
                            this.myRoutes.add( card, true )
                        }
                    }
                    else {
                        card = new RouteCard(route,{list:this.myRoutes})
                        card.verify()
                        card.save()
                        card.enableDelete()
    
                        this.myRoutes.add( card, true )
                        this.routes.push(route)
                    }
                    card.enableDelete(true)              
                    this.emitLists('updated')     
    
                    this.verifyPoints(card,route)
    
                   
                }
                catch(err) {
    
                    // TODO handle parsing errors
                    // idea: either show error card(s) or show error dialog
                    console.log('ERROR PARSNG ', err)
                }
        
            })
    

        }
        catch(err) {
            this.logError(err,'import',info)
        }
    }

    emitLists( event:'loaded'|'updated') {
        try {
            const lists = this.getLists()
            if (this.observer)
                this.observer.emit(event,lists)
    
        }
        catch(err) {
            this.logError(err,'emitLists',event)

        }
    }


    getCard(id:string):RouteCard {
        const res = this.findCard(id)
        return res?.card
    }


    protected getFilterContentTypes():Array<string> {
        return ['GPX','Video']
    }

    protected getFilterRouteTypes():Array<string> {
        return ['Loop','Point to Point']
    }

    protected getFilterCountries():Array<string> {
        try {
            const countries = []

            this.routes.forEach(r=> {
                const iso = r.description.country 
                let country = 'Unknown'
                if (iso)
                    country = getCountries().getCountryFromIso(iso)

                if (!countries.includes(country))
                    countries.push(country)
            } )


            const sortFn = (a,b) => {
                if (a==='Unknown')
                    return -1
                if (b==='Unknown')
                    return 1
                
                return a>b ? 1 : -1
            }

            return countries.sort( sortFn)
        }
        catch (err) {
            console.log('~~~ ERROR',err)
            this.logError(err,'getFilterCountries')
            return []
        }
    }




    protected addRoute(route:Route):void {
        const list = this.selectList(route)
        console.log('~~~ addCard ', route.description.title,route.description.id, list.getId())

        const card = new RouteCard(route,{list})
        card.verify()
        list.add( card)
        if ( list.getId()==='myRoutes')
            card.enableDelete(true)    
        this.routes.push(route)
        
        this.emitLists('updated')                

    }

    protected async verifyPoints(card:RouteCard, route:Route):Promise<void> {
        const updated = await route.updateCountryFromPoints()
        
        if (updated) {             
            card.updateRoute(route)
        }        
    }

    protected async addFromApi(route:Route):Promise<void> {

        console.log('~~~ addCard from API', route.description.title)
        const existing = this.findCard(route)
        if (existing) 
            return;
        this.addRoute(route)
    }

    protected async update(route:Route):Promise<void> { 
        const existing = this.findCard(route)
        if (existing)        
            existing.card.updateRoute(route)
    }

    protected async loadRoutes():Promise<void> {

        await this.loadRoutesFromRepo()
        await this.loadRoutesFromApi()
    }

    protected async loadRoutesFromRepo():Promise<void> {

        return new Promise<void> ( done => {
            const observer = this.db.load()
            const add = this.addRoute.bind(this)
            const update = this.update.bind(this)
    
            observer.on('route.added',add)
            observer.on('route.updated',update)
            observer.on('done',done)
    
        })

    }
    protected async loadRoutesFromApi():Promise<void> {

        
        const observer = this.api.load()
        const add = this.addFromApi.bind(this)
        const update = this.update.bind(this)

        observer.on('route.added',add)
        observer.on('route.updated',update)

    }

    protected selectList(route:Route):CardList<Route> {
        const description = route.description
        const category = description.category?.toLocaleLowerCase()

        if (!description.hasVideo) {
            if (category==='personal' || description.isLocal)
                return this.myRoutes
            return description.category ? this.alternatives : this.selectedRoutes
        }
        else {
            if (description.isLocal)
                return this.myRoutes
            if (description.isDemo)
                return this.alternatives

            if (category===undefined || category==='personal' || category==='imported')
                return this.myRoutes
            
            return this.selectedRoutes
            

        }

    }




    async createPreview( descr:RouteInfo) {

        try {
            const routesApi = IncyclistRoutesApi.getInstance() 
            const previewUrl = await routesApi.getRoutePreview(descr.id)
            if (previewUrl) {
                descr.previewUrl = previewUrl
                return;
            }
        }
        catch {
            // ignrore - we will try to create it with ffmpeg
        }
        
        // As we would be overloading ffmpeg by creating multiple screenshots
        // at the same time, we are queueing the requests        
        return new Promise( done => {
            this.createPreviewQueue.push( {descr,done} )
            this.processPreviewQueue()
    
        })
    }

    protected async doCreateScreenShot( descr:RouteInfo):Promise<string> {

        let props 
        const videoUrl = descr.videoUrl || descr.downloadUrl
        const previewUrl = descr.previewUrl

        if (valid(previewUrl))
            return previewUrl

        const appInfo = getBindings().appInfo
        const path = getBindings().path
        const fs = getBindings().fs
        
        const outDir = path.join( appInfo.getAppDir(),'previewImg')
        fs.checkDir(outDir)

        

        if (!videoUrl)
            return;

        if (videoUrl.startsWith('http') ) {
            props = {size:'384x216',outDir}             
        }
        else {
            props = {size:'384x216'} 
        }
       

        const video = getBindings().video
        if (video.isScreenshotSuported()) {
            try {
                this.logEvent({message:'creating preview', title:descr.title, id:descr.id, video:videoUrl})
                descr.previewUrl = await video.screenshot( videoUrl, props)
                this.logEvent({message:'preview created' , title:descr.title, id:descr.id, video:videoUrl, preview:descr.previewUrl})
                return descr.previewUrl

                
            }
            catch(err) {
                // old App does not support creation of screenshots - ignore
                if (err.message==='not supported')
                    return;

                this.logError(err,'createPreview')
            }
        }

    }

    protected processPreviewQueue():PromiseObserver<void> {

        const run = async()=>{
            while ( this.createPreviewQueue.length>0) {

                const {descr,done} = this.createPreviewQueue.shift()
                
                const res = await this.doCreateScreenShot(descr)      
                done(res)    
            }
            process.nextTick( ()=>{ delete this.previewProcessing})
        }

        if (!this.previewProcessing) {
            this.previewProcessing = new PromiseObserver( run() )
        }
        return this.previewProcessing

    }


    protected findCard(target:Route|string):{ card:RouteCard, list:CardList<Route>} {
        
        let id:string;
        if (typeof target==='string') {
            id = target
        }
        else {
            const route = target as Route
            id = route.description.id
        }


        let card =this.myRoutes.getCards().find(c=>c.getData()?.description?.id===id) as RouteCard
        if (card)
            return {card,list:this.myRoutes}
        
        card = this.selectedRoutes.getCards().find(c=>c.getData()?.description?.id===id)  as RouteCard
        if (card)
            return {card,list:this.selectedRoutes}

        card = this.alternatives.getCards().find(c=>c.getData()?.description?.id===id) as RouteCard
        if (card)
            return {card,list:this.alternatives}

        return ;
    }

    protected resetCards() {
        this.getLists().forEach( list=> {
            list.getCards().forEach( (card) => {
                card.reset()
            })
        })

    }

    protected getAllCards() {
        const cards:Array<RouteCard> = []
        
        this.getLists(false)?.forEach( list=> {
            list.getCards().forEach( (card) => {
                // filter out special cards
                if (card.getCardType()==='Import'||card.getCardType()==='Free-Ride'  )
                    return;
                cards.push(card as RouteCard)
            })
        })
        return cards;

    }

}


export const useRouteList = ()=>new RouteListService()
export const getRouteList = ()=>new RouteListService()