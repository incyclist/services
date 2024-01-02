import { FileInfo, getBindings} from "../../api";
import { CardList } from "../../base/cardlist";
import { IncyclistService } from "../../base/service";
import { Singleton } from "../../base/types";
import { Observer, PromiseObserver } from "../../base/types/observer";
import { RouteApiDetail } from "../base/api/types";
import { Route } from "../base/model/route";
import { RouteParser  } from "../base/parsers";
import { RouteInfo } from "../base/types";
import { RoutesApiLoader } from "./loaders/api";
import {  RouteImportCard } from "./cards/cards";
import { FreeRideCard } from "./cards/FreeRideCard";
import { MyRoutes } from "./lists/myroutes";
import { RouteCard, SummaryCardDisplayProps } from "./cards/RouteCard";
import { RouteStartSettings } from "./types";
import { RoutesDbLoader } from "./loaders/db";
import { valid } from "../../utils/valid";



type RouteListEvent = 'started' | 'stopped' | 'loaded' | 'updated' |'selected'
class RouteListObserver extends Observer {

    constructor( protected service:RouteListService) { 
        super()
    }
    stop() {
        this.service.close()
        this.emit('stopped')
    }

    emit(event:RouteListEvent,...payload) {
        this.emitter.emit(event,...payload)
    }

    getLists():Array<CardList<Route>> {
        return this.service.getLists()
    }


}

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
    protected filters

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

    open():RouteListObserver {
        this.logEvent( {message:'open route list'})

        const hasLists = this.getLists()?.length>0

        let newObserver = false;

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

        // selection already ongoing, return existing observer
        if (!this.observer) {
            this.observer = new RouteListObserver(this)
            newObserver = true;
            //tsCreated = Date.now()
            emitStartEvent()
        }        

        // if preload has not been started yet, load data
        if (!this.initialized && !this.preloadObserver) {
            this.preload()
        }
        // if we are re-opening the page, ensure that no route is selected
        else if (this.initialized && !this.preloadObserver) {
            this.unselect()
        }

        if (this.preloadObserver){
            this.preloadObserver.once('done',()=>{
                // TODO 
            })
        }

        if (newObserver) {
            if (this.initialized && !hasLists)
                emitLoadedEvent()
            
        }

        this.getLists()?.forEach( list=> {
            list.getCards()?.forEach( (card,idx) => {
                card.setInitialized(false)
                if (idx>0)
                    card.setVisible(false)
            })
        })
        

        return this.observer
    }



    close():void {
        this.logEvent( {message:'close route list'})
        this.observer?.emit('stopped')
        delete this.observer;

        this.resetCards()


    }

    getFilters() {
        return this.filters
    }

    

    search( filters? ) {
        this.filters = filters

        let routes:Array<SummaryCardDisplayProps> =   this.getAllCards().map( c=> c.getDisplayProperties())


        if (filters?.title && filters.title.length)
            routes = routes.filter( r => r.title.includes(filters.title))

        if (filters?.distance?.min)
            routes = routes.filter( r => r.distance>=filters?.distance?.min)

        if (filters?.distance?.max)
            routes = routes.filter( r => r.distance<=filters?.distance?.max)

        if (filters?.elevation?.min)
            routes = routes.filter( r => r.distance>=filters?.elevation?.min)
        
        if (filters?.elevation?.max)
            routes = routes.filter( r => r.distance<=filters?.elevation?.max)

        if (filters?.elevation?.max)
            routes = routes.filter( r => r.distance<=filters?.elevation?.max)


        return routes
    }


    onResize(current,prev) {
        console.log('~~~ RESIZE',current,prev)
        this.resetCards()
        /*
        this.getLists().forEach( list=> {
            list.getCards().forEach( (card,idx) => {
                card.setInitialized(false)
                if (idx>0)
                    card.setVisible(false)
            })
        })
        */

    }
    onCarouselInitialized(list:CardList<Route> /*,item,itemsInSlide*/) {
        //console.log('~~~ INITIALIZED',(new Date()).toISOString(), list,item,itemsInSlide)

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

    setLanguage(language:string) {this.language = language}
    getLanguage():string {return this.language}



    preload():PromiseObserver<void> {
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

        return this.preloadObserver
    }

    getUILists():Array<CardList<Route>> {
        if (!this.initialized || this.preloadObserver || !this.observer)
            return null;

        return [ this.myRoutes, this.selectedRoutes, this.alternatives]

    }

    getLists(forUi:boolean=true):Array<CardList<Route>> {
        
        if (forUi && (!this.initialized || this.preloadObserver))
            return null;

        return [ this.myRoutes, this.selectedRoutes, this.alternatives]

    }

    getList(id:string):CardList<Route> { 
        switch(id) {
            case 'myRoutes': return this.myRoutes;
            case 'selected': return this.selectedRoutes;
            case 'alternatives': return this.alternatives;
            default: null
        }
    }

    getStartSettings():RouteStartSettings {
        return this.startSettings;
    }

    setStartSettings(settings:RouteStartSettings) {
        this.startSettings = settings
    }

    getSelected():Route {
        return this.selectedRoute
    }
    getSelectedRoute():RouteApiDetail {
        return this.selectedRoute.details
    }

    unselect() {
        this.selectedRoute = null    
        this.startSettings = null;
    }

    select(route:Route) {
        this.selectedRoute = route
    }

    import( info:FileInfo|Array<FileInfo>):void {
        const files = Array.isArray(info) ? info : [info]

        files.forEach( async (file)=>{
            try {
                const {data,details} = await RouteParser.parse(file)              

                const route = new Route(data,details as RouteApiDetail)
                
                const existing = this.getCard(route)
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
                        
                        this.myRoutes.add( card, true )
                    }
                }
                else {
                    card = new RouteCard(route,{list:this.myRoutes})
                    card.verify()
                    card.save()

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

    protected addRoute(route:Route):void {
        const list = this.selectList(route)
        const card = new RouteCard(route,{list})
        card.verify()
        list.add( card)
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

        const existing = this.getCard(route)
        if (existing)        
            return;
        this.addRoute(route)
    }

    protected async update(route:Route):Promise<void> { 
        const existing = this.getCard(route)
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


    emitLists( event:'loaded'|'updated') {
        const lists = this.getLists()
        if (this.observer)
            this.observer.emit(event,lists)
    }

    setScreenProps(props) {
        this.screenProps = props
    }

    getScreenProps() {
        return this.screenProps
    }

    findCard(id:string) {
        const res = this.getCard(id)
        return res?.card
    }

    protected getCard(target:Route|string):{ card:RouteCard, list:CardList<Route>} {
        
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