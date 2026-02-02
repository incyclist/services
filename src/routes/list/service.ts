import { FileInfo, getBindings} from "../../api";
import { Card, CardList } from "../../base/cardlist";
import { IncyclistService } from "../../base/service";
import { Observer, Singleton } from "../../base/types";
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
import { ActiveRideCount, DisplayType, IRouteList, RouteDetailUIItem, RouteListLog, RouteStartSettings, SearchFilter, SearchFilterOptions } from "./types";
import { RoutesDbLoader } from "./loaders/db";
import { valid } from "../../utils/valid";
import { getCountries  } from "../../i18n/countries";
import { RouteListObserver } from "./RouteListObserver";
import IncyclistRoutesApi from "../base/api";
import { ActiveImportCard } from "./cards/ActiveImportCard";
import { SelectedRoutes } from "./lists/selected";
import { AlternativeRoutes } from "./lists/alternatives";
import { getRepoUpdates, updateRepoStats } from "./utils";
import { useUserSettings } from "../../settings";
import { Injectable } from "../../base/decorators";
import { RouteSyncFactory } from "../sync/factory";
import { sleep } from "../../utils/sleep";
import { useAppsService } from "../../apps";
import { useAppState } from "../../appstate";
import { useUnitConverter } from "../../i18n";
import clone from "../../utils/clone";


const SYNC_INTERVAL = 5* 60*1000

@Singleton
export class RouteListService  extends IncyclistService implements IRouteList {

    protected myRoutes: MyRoutes
    protected selectedRoutes: CardList<Route> 
    protected alternatives: CardList<Route> 
    protected routes: Array<Route>
    protected custom: Array<CardList<Route>>

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
    protected prevFilters: SearchFilter
    protected listTop: Record<DisplayType,number> = { list:undefined, tiles:undefined }
    protected displayType: DisplayType
    protected syncInfo:  {iv?: NodeJS.Timeout, observer?: Observer} 
    protected currentView: 'list'|'grid'|'routes'
    protected stats

    constructor () {
        super('RouteList')

        this.myRoutes = new MyRoutes('myRoutes','My Routes')
        this.selectedRoutes = new SelectedRoutes('selected','Selected For Me')
        this.alternatives = new AlternativeRoutes('alternaties','Alternatives')
        this.initialized = false;
        this.language = 'en'
        
        this.myRoutes.add( new RouteImportCard())
        this.myRoutes.add( new FreeRideCard())
        this.api = new RoutesApiLoader()
        this.db = new RoutesDbLoader()
        this.createPreviewQueue = []
        this.routes = []
        this.filters = this.getFilters()

        this.syncInfo = {}

        this.getRouteSyncFactory().setRouteList(this)
        this.handleConfigChanges()
        this.custom = []
    }


    // Getters && Setters
    setLanguage(language:string) {this.language = language}
    getLanguage():string {return this.language}
    getStartSettings():RouteStartSettings { return this.startSettings; }
    setStartSettings(settings:RouteStartSettings) { this.startSettings = settings }
    getSelected():Route { return this.selectedRoute }
    setScreenProps(props) {this.screenProps = props }
    getScreenProps() { return this.screenProps}
    

    open():{observer:RouteListObserver,lists:Array<CardList<Route>>} {

        this.currentView = 'routes'

        try {
            this.logEvent( {message:'open route list'})
            const hasLists = this.getLists()?.length>0

            const emitStartEvent = async()=> {
                process.nextTick( ()=>{   
                    this.observer?.emit('started')
                })
                
            }
            const emitLoadedEvent = async()=> {
                this.resetLists()
                process.nextTick( ()=>{
                    this.emitLists('loaded')
                })
            }

            this.myRoutes.removeActiveImports()
  
    
            // selection already ongoing, return existing observer
            if (!this.observer) {
                this.observer = new RouteListObserver(this)
                emitStartEvent()
            }        
    
            // if preload has not been started yet, load data
            if (this.isStillLoading()) {
                const preload = this.preload()
                preload.start().then( emitLoadedEvent )
            }
            // if we are re-opening the page, ensure that no route is selected
            else if (this.initialized ) {
                this.unselect()
            }
            
            if (this.initialized && !hasLists)
                emitLoadedEvent()

            this.observer.on('stats-update', this.onRouteStatsUpdate.bind(this))
            this.emit('opened', this.observer, this.stats===undefined )

            // enforce redraw of cards if units have changed by user (metric<->imperial)
            const unitsObserver = this.getUserSettings().requestNotifyOnChange('routeList','preferences.units' )
            unitsObserver.on( 'changed',this.redrawCards.bind(this))

                
        }
        catch (err) {
            this.logError(err,'open')
        }

        this.resetLists()
        this.getAppState().setPersistedState('page','routes')
        return {observer: this.observer, lists:this.getLists() }
    }

    protected redrawCards() {
        const lists = this.getLists()
        lists.forEach( list=> {
            const cards = list.getCards()
            cards.forEach( card => {
                if (card.getCardType()==='Route' && card.isVisible() ) {
                    const rc:RouteCard = card as RouteCard
                    rc.emitRedraw()
                }
                
            })
        })
        

    }

    private resetLists() {

        const screenProps = this.getScreenProps()??{}
        let maxVisible = screenProps.itemsFit? screenProps.itemsFit+1:0
        

        this.getLists(false)?.forEach(list => {
            list.getCards()?.forEach((card, idx) => {
                card.setInitialized(false)
                card.setVisible(idx<maxVisible);
            });
        });
    }

    close():void {
        try {
            this.logEvent( {message:'close route list'})
            this.emit('closed', this.observer )
            this.observer?.emit('stopped')
            this.observer?.reset()
            this.getUserSettings().stopNotifyOnChange('routeList')
   
            this.resetCards()   
        }
        catch(err) {
            this.logError(err, 'close')
        }
    }

    saveFilters(requestedFilters?:SearchFilter) {        
        if (!requestedFilters) {
            this.filters = {}
            const settingsFilter = {}
            const settings = this.getUserSettings()
            settings.set('preferences.search.filter',settingsFilter??null)
            return
        }

        this.filters = clone(requestedFilters)
        const settingsFilter = clone(requestedFilters)


        const [C,U] = this.getUnitConverter().getUnitConversionShortcuts()

        const Dist = (v) => {
            if (v?.value!==undefined && v.unit ) {
                return C(v.value,'distance',{from:v.unit,to:'m'})
            }
            return v
        }
        const El = (v) => {
            if (v?.value!==undefined && v.unit ) {
                return C(v.value,'elevation',{from:v.unit,to:'m'})
            }
            return v
        }

        if (settingsFilter.elevation) {
            const v = settingsFilter.elevation
            settingsFilter.elevation ={ min:El(v.min), max:El(v.max) }
        }
        if (settingsFilter.distance) {
            const v = settingsFilter.distance
            settingsFilter.distance ={ min:Dist(v.min), max:Dist(v.max) }
        }


        const settings = this.getUserSettings()
        settings.set('preferences.search.filter',settingsFilter??null)
    }

    getFilters():SearchFilter {
        try {
            if (!this.filters) {
                const settings = this.getUserSettings()
                this.filters = settings.get('preferences.search.filter',undefined)

                const [C,U] = this.getUnitConverter().getUnitConversionShortcuts()

                if (this.filters.elevation) {
                    const v = this.filters.elevation
                    const min = v.min===undefined ? undefined: { value:C( v.min,'elevation',{from:'m',digits:0}), unit:U('elevation') }
                    const max = v.max===undefined ? undefined: { value:C( v.max,'elevation',{from:'m',digits:0}), unit:U('elevation') }
                    this.filters.elevation = {min,max}                    
                }
                if (this.filters.distance) {
                    const v = this.filters.distance
                    const min = v.min===undefined ? undefined: { value:C( v.min,'distance',{from:'m',digits:1}), unit:U('distance') }
                    const max = v.max===undefined ? undefined: { value:C( v.max,'distance',{from:'m',digits:1}), unit:U('distance') }
                    this.filters.distance = {min,max}                    
                }


            }
        }
        catch {}

        return this.filters

    }

    protected searchAgain() {
        return this.searchRepo(this.prevFilters)
    }

    search( requestedFilters?:SearchFilter ) {
        this.currentView = 'list'
        if (!this.initialized)
            this.preload();


        const filters = requestedFilters || this.filters

        if (filters!==this.prevFilters) {
            this.prevFilters = filters
            this.saveFilters(filters)
        }

        const res = this.searchRepo(filters)

        this.observer.on('stats-update', this.onRouteStatsUpdate.bind(this))
        this.emit('opened', this.observer, this.stats===undefined )


        this.getAppState().setPersistedState('page','search')
        return res

    }

    getVisibleRoutes():Array<Route> {
        return this.routes.filter( r=>r.description && !r.description.isDeleted)
    }

    getAllAppRoutes( source:string ):Array<RouteInfo> {
        let routes = this.routes.map(r=>r.description)
        routes = this.applySourceFilter({routeSource:source},routes)
        return routes

    }

    getAllRoutes():Array<Route> {
        return this.routes
    }


    searchRepo( requestedFilters?:SearchFilter ) {
        if (!this.observer) {
            this.observer = new RouteListObserver(this)
        }

        try {

            const filters = requestedFilters ?? this.filters

            let routes:Array<SummaryCardDisplayProps> = Array.from(this.getAllSearchCards().map( c=> c.getDisplayProperties()))
            routes.sort( (a,b) => a.title>b.title? 1 : -1)

            if (!filters) {                
                return {routes,filters,observer:this.observer}
            }


            if (!filters.includeDeleted)
                routes = routes.filter( r =>  !r?.isDeleted)

            routes = this.applyTitleFilter(filters, routes);
            routes = this.applyDistanceFilter(filters, routes);
            routes = this.applyElevationFilter(filters, routes);
            routes = this.applyCountryFilter(filters, routes);
            routes = this.applyContentTypeFilter(filters, routes);
            routes = this.applyRouteTypeFilter(filters, routes);
            routes = this.applySourceFilter(filters,routes) as SummaryCardDisplayProps[]

            const cards = routes.map( r => this.getCard(r.id))

            this.setListTop('list',0)
            this.setListTop('tiles',0)

            const units = this.getUnitConverter().getDefaultUnits()
          
            return {routes,cards,filters,observer:this.observer,units}
    
        }
        catch(err) {
            this.logError(err,'search')
            return {routes:[], filters:{}}

        }
    }


    /*

    
    */
    



    
    /**
     * Stores the current top position of the RouteList in the list component for a specified display type.
     * 
     * This value is used to restore the position when the RouteList is re-opened
     * 
     * If the first parameter is a number, it is interpreted as the top position and the current display type is used.
     * If the first parameter is a string (DisplayType), the top position is expected as the second parameter.
     * 
     * @param display The display type for which the top position is requested, or the top position itself.
     * @param [top] The top position of the first item in the list, if display is a DisplayType.
     * 
     * 
     * @example
     * // Set the top position for the "list" display type
     * routeListService.setListTop('list', 100);
     * 
     * // Set the top position for the currently selected display type
     * routeListService.setListTop(200);
     */
    setListTop(display: number|DisplayType, top?:number) {
        const displayType = typeof display === 'number' ? this.displayType : display 
        const topValue = typeof display === 'number' ? display : top
        
        this.listTop[displayType] = topValue
    }

    /**
     * Retrieves the current top position of the RouteList for a specified display type.
     *
     * This value is used to restore the position when the RouteList is re-opened
     *
     * @param display The display type for which the top position is requested.
     * @returns The top position of the first item in the list for the specified display type.
     */
    getListTop(display: DisplayType = this.displayType) {
        return this.listTop[display]
    }

    /**
     * Sets the display type for the RouteList.
     * 
     * This method updates the current display type, which determines how the list is presented.
     * 
     * @param displayType The display type to be set.
     */

    setDisplayType(displayType:DisplayType) {
        this.displayType = displayType
        this.getUserSettings().set('preferences.routeListDisplayType', displayType)        
    }

    getDisplayType():DisplayType {
        return this.displayType ??  this.getUserSettings().get('preferences.routeListDisplayType', 'list')        
    }
    

    /**
     * checks if the preload is still ongoing
     * 
     * @returns true, if the preload is still ongoing, false otherwise
     */
    isStillLoading():boolean { 
        return !!this.preloadObserver
    }


    private applyRouteTypeFilter(filters: SearchFilter, routes: SummaryCardDisplayProps[]) {
        if (filters.routeType) {
            const loop = filters.routeType === undefined || filters.routeType === 'Loop';
            const p2p = filters.routeType === undefined || filters.routeType === 'Point to Point';
            routes = routes.filter(r => (loop && r.isLoop) || (p2p && !r.isLoop));
        }
        return routes;
    }

    private applySourceFilter(filters: SearchFilter, routes: RouteInfo[]) {
        routes = routes.filter( r=> r.source===undefined || this.getAppsService().isEnabled(r.source,'RouteDownload') )
        
        if (filters.routeSource) {
            const local = filters.routeSource==='Local'
            const internal = filters.routeSource==='Incyclist';
            const sources = filters.routeSource.split('|').map( s=> this.getAppsService().getKey(s))
            
            routes = routes.filter(r => 
                (r.source===undefined && !r.isLocal && internal) ||  
                (r.source===undefined && r.isLocal && local) ||                  
                (r.source && !internal && sources.includes(r.source))
            );
        }
        return routes;
    }

    private applyContentTypeFilter(filters: SearchFilter, routes: SummaryCardDisplayProps[]) {
        if (filters.contentType) {
            const video = filters.contentType === undefined || filters.contentType === 'Video';
            const gpx = filters.contentType === undefined || filters.contentType === 'GPX';
            routes = routes.filter(r => (video && r.hasVideo) || (gpx && !r.hasVideo));
        }
        return routes;
    }

    private applyCountryFilter(filters: SearchFilter, routes: SummaryCardDisplayProps[]) {
        if (filters.country) {
            const iso = filters.country === 'Unknown' ? undefined : getCountries().getIsoFromCountry(filters.country);
            routes = routes.filter(r => r.country === iso);
        }
        return routes;
    }

    getFilterValue(filters: SearchFilter, scope:'distance'|'elevation', minMax:'min'|'max'):number {
        if (!filters)
            return
        const obj = filters[scope]
        if (!obj)
            return;
        const v = obj[minMax]
        if (v===undefined || v===null )
            return 
        if (typeof v==='number')
            return v

        if (v.value!==undefined && v.unit) {
            return this.getUnitConverter().convert(v.value,scope,{from:v.unit,to:'m'})
        }
        return
    }

    private applyElevationFilter(filters: SearchFilter, routes: SummaryCardDisplayProps[]) {

        const elevationMin = this.getFilterValue(filters,'elevation','min')
        const elevationMax = this.getFilterValue(filters,'elevation','max')

        if (elevationMin!==undefined)
            routes = routes.filter(r => r.elevation >= elevationMin);

        if (elevationMax!==undefined)
            routes = routes.filter(r => r.elevation <= elevationMax);
        return routes;
    }

    private applyDistanceFilter(filters: SearchFilter, routes: SummaryCardDisplayProps[]) {
        const distanceMin = this.getFilterValue(filters,'distance','min')
        const distanceMax = this.getFilterValue(filters,'distance','max')

        if (distanceMin!==undefined)
            routes = routes.filter(r => r.distance >= distanceMin);

        if (distanceMax!==undefined)
            routes = routes.filter(r => r.distance <= distanceMax);
        return routes;
    }

    private applyTitleFilter(filters: SearchFilter, routes: SummaryCardDisplayProps[]) {
        if (filters.title?.length) {
            routes = routes.filter(r => r.title?.toUpperCase()?.includes(filters.title.toUpperCase()));
        }
        return routes;
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
        let routeSources = []

        try {
            countries = this.getFilterCountries();
            contentTypes = this.getFilterContentTypes();
            routeTypes = this.getFilterRouteTypes()
            routeSources = this.getFilterRouteSources()
        }
        catch (err) {
            this.logError(err,'getFilterOption')
        }
        return {countries,contentTypes,routeTypes,routeSources}
    }

    onResize() {
        try {
            this.resetCards()
        }
        catch(err) {
            this.logError(err,'onResize')
        }

    }

    onCarouselInitialized(list:CardList<Route>, item,itemsInSlide) {
        try {
            list.getCards().forEach( (card,idx) => {
                card.setVisible(idx<item+itemsInSlide)
                card.setInitialized(true)
            })

            // after 100ms set next items to visible
            setTimeout ( ()=>{ 
                list.getCards().forEach( (card,idx) => { 
                    card.setVisible(true)
                })
            },100)

        }
        catch(err) {
            this.logError(err,'onCarouselInitialized')
        }
        
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onCarouselUpdated(list) {

        try {

            list.getCards().forEach( (card) => {          
                card.setVisible(true)
            })



        }
        catch(err) {
            this.logError(err,'onCarouselUpdated')
        }

    }


    /**
     * triggers the loading of the routes from local repo
     * 
     * This method should be called by the UI as soon as possible to reduce loading time for the user
     * 
     * @returns observer that indicates an ongoing preload
     * 
     * Besides the events signalled by the returned Observer, the following events are signalled
     * on the service observer:
     * 
     * @emits loading   list is being loaded
     * @emits loaded    loading has been completed, provides lists as parameter
     */
    preload():PromiseObserver<void> {
        try {
            this.logEvent( {message:'preload route list'})
            if (!this.isStillLoading()) {
                const promise = this.loadRoutes()
                this.preloadObserver = new PromiseObserver<void>( promise )
    
                this.preloadObserver.start()
                    .then( ()=> { 
                        this.initialized = true
                        
                        this.logEvent( {message:'preload route list completed'})
                        this.updateRepoStats()
                        this.emitLists('loaded',{log:true})
                        process.nextTick( ()=>{delete this.preloadObserver})
                    })
                    .catch( (err)=> {
                        this.logError(err,'preload')
                        this.preloadObserver?.stop()
                        process.nextTick( ()=>{delete this.preloadObserver})
                    })
            }
    
    
        }
        catch(err) {
            this.logError(err,'preload')
            this.preloadObserver?.stop()
            process.nextTick( ()=>{delete this.preloadObserver})
        }
        return this.preloadObserver
    }



    private createRoutesLogEntry(includeDetails=false):RouteListLog {
        try {
            const log:RouteListLog = {
                counts: {
                    myRoutes: this.myRoutes.length,
                    selected: this.selectedRoutes.length,
                    alternatives: this.alternatives.length
                }
            };

            if(includeDetails) {
                log.titles = {}
                const getTitleLog = (list) => list?.getCards()?.map( r=> r.getTitle()).join(',')
                
                log.titles.myRoutes = getTitleLog(this.myRoutes)
                log.titles.selected = getTitleLog(this.selectedRoutes)
                log.titles.alternaties = getTitleLog(this.alternatives)
            }

            return log
        }
        catch(err) {
            this.logError(err,'createRoutesLogEntry')
        }
    
    }

    getLists(forUi:boolean=true):Array<CardList<Route>> {
        try {
            if (forUi && (!this.initialized))
                return null;

            const lists:Array<CardList<Route>> = [ this.myRoutes ]
            if ( this.selectedRoutes?.length>0) 
                lists.push(this.selectedRoutes)
            this.custom.forEach( (l)=>{
                if ( this.getAppsService().isEnabled(l.getId(),'RouteDownload') &&  l.length>0)
                    lists.push(l)
            })
            if ( this.alternatives?.length>0) 
                lists.push(this.alternatives)

            return lists

        }
        catch(err) {
            this.logError(err,'getLists')
            return [ this.myRoutes]
        }

    }




    async getRouteDetails(id:string, expectLocal=false):Promise<RouteDetailUIItem> {
        try {
            const route = this.getVisibleRoutes().find( r => r.description.id===id)
            if (!route) 
                return;

            if (expectLocal && route.description.requiresDownload && !route.description.isDownloaded) {
                return;
            }

            if (!route.details) {
                await this.loadRouteDetails(route, id);
            }

            this.verifyRouteCountry(route);
            const [C,U] = this.getUnitConverter().getUnitConversionShortcuts()

            const distance = route.details?.distance??route.description?.distance
            const elevation = route.details?.elevation??route.description?.elevation

            const totalDistance = distance===undefined ? undefined : {value: C(distance,'distance'), unit:U('distance')}
            const totalElevation = elevation===undefined ?  undefined : {value: C(elevation,'elevation'), unit:U(elevation) }

            return {...route.details, totalDistance, totalElevation}
        }
        catch(err) {
            this.logError(err,'getRouteDetails',{id})
        }
    }


    getRouteDescription(id:string) {
        try {
            return this.getVisibleRoutes().find( r => r.description.id===id)?.description
        }
        catch(err) {
            this.logError(err,'getRouteDescription',id)
        }
    }
    getRoute(id:string) {
        try {
            return this.getVisibleRoutes().find( r => r.description.id===id)
        }
        catch(err) {
            this.logError(err,'getRoute',id)
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

    selectCard(card:Card<Route>) {
        this.selectedRoute = card.getData()
        
    }
    unselectCard(card:Card<Route>) {
        if ( this.selectedRoute === card.getData())
            this.selectedRoute = undefined
    }

    import( info:FileInfo|Array<FileInfo>, retry?:ActiveImportCard):void {
        try {
            const files = Array.isArray(info) ? info : [info]

            const importCards: Array<ActiveImportCard> = []

            if (!retry) {
                files.forEach( (file)=>{
                    if (!file)
                        return;

                    const card = this.addImportCard(file)
                    importCards.push(card)
                    this.emitLists('updated')
                })
            }
            else {
                importCards.push(retry)
            }


            files.forEach( async (file,idx)=>{
                if (!file)
                    return;
                const importCard = importCards[idx]
                
                const name = file.url??file.filename??file.name
            
                try {

                    this.logEvent({message:'start import', name})

                    const {data,details} = await RouteParser.parse(file)     
                    this.logEvent({message:'import completed', name})

                    const route = new Route(data,details)
                    route.description.tsImported = Date.now()
                    
                    const existing = this.findCard(route)
    
                    if (existing ) {   
                        existing.list.remove( existing.card)
                    }
                    else  {
                        this.routes.push(route)
                    }
                        
                    const card = new RouteCard(route,{list:this.myRoutes})
                    card.verify()
                    card.save()
                    card.enableDelete()
                    
                    this.myRoutes.add( card, true )

                    this.myRoutes.remove(importCard)
                    card.enableDelete(true)              
                    this.emitLists('updated',{log:true})     
    
                    this.verifyPoints(card,route)
    
                   
                }
                catch(err) {
                    this.logEvent({message:'import failed', name, reason:err.message, stack:err.stack})
                    importCard.setError(err)
                }
        
                
            })
    

        }
        catch(err) {
            this.logError(err,'import',info)
        }
    }

    emitLists( event:'loaded'|'updated',props?:{log?:boolean, source?:'user'|'system'}) {

        try {

            const {log,source='user'} = props??{}

            if (this.currentView === 'grid'||this.currentView ==='list') {
                const d = this.searchAgain()
                this.observer.emit(event,d,source)
                return;
            }

            if (log) {
                const logs = this.createRoutesLogEntry(true)??{}
                this.logEvent({message:`RoutesList ${event}`, ...logs})
        
            }


            const lists = this.getLists()
           
            if (this.observer)
                this.observer.emit(event,lists,source)
    
        }
        catch(err) {
            this.logError(err,'emitLists',event)

        }
    }


    getCard(id:string):RouteCard {
        const res = this.findCard(id)
        return res?.card
    }

    // card has already removed itself from the list and needs to be re-added (most likely on MyRoutes)
    addCardAgain(card:RouteCard) {        
        const route = card.getData()        
        const list = this.selectList(route)
        list.add( card)
        card.enableDelete(list.getId()==='myRoutes')
        card.setList(list)
        this.emitLists('updated',{log:true})                

    }

    protected addImportCard(file:FileInfo):ActiveImportCard {
        const card = new ActiveImportCard(file)
        this.myRoutes.addImport(card)
        this.emitLists('updated')                
        return card

    }

    protected getFilterContentTypes():Array<string> {
        return ['GPX','Video']
    }

    protected getFilterRouteTypes():Array<string> {
        return ['Loop','Point to Point']
    }

    protected getFilterRouteSources():Array<string> { 
        const options = ['Local','Incyclist']
        
        this.getVisibleRoutes().forEach(r=> {
            const source = r.description.source  
            if (!source) 
                return;
            
            const option = this.getAppsService().getName(source)
            if (option && !options.includes(option)) {
                options.push(option)
            }

        })
        
        return options
    }

    protected getFilterCountries():Array<string> {
        try {
            const countries = []

            this.getVisibleRoutes().forEach(r=> {
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
            this.logError(err,'getFilterCountries')
            return []
        }
    }




    protected addRoute(route:Route,source:'user'|'system'='system'):void {

        this.routes.push(route)
        if (route.description?.isDeleted)
            return;

        if (!route.description?.isDeleted) {
            if (source==='user') {
                this.logEvent({message:'route added', route:route.description.title, source: route.description.source})
            }

            if (!route.description.country) {
                route.updateCountryFromPoints()
                    .then( ()=> {
                        this.db.save(route,false)
                    })
            }
        }
        

        const list = this.selectList(route)

        const card = new RouteCard(route,{list})
        card.verify()
        list.add( card)
        if ( list.getId()==='myRoutes')
            card.enableDelete(true)    
        
        this.emitLists('updated',{source})                

    }

    protected async verifyPoints(card:RouteCard, route:Route):Promise<void> {
        const updated = await route.updateCountryFromPoints()
        
        if (updated) {             
            card.updateRoute(route)
        }        
    }

    protected async addFromApi(route:Route):Promise<void> {

        const existing = this.findCard(route)
        if (existing) 
            return;
        this.addRoute(route,'system')
    }

    protected async update(route:Route,source:'user'|'system'='user'):Promise<void> { 
        const existing = this.findCard(route)
        if (existing)        
            existing.card.updateRoute(route)
    }

    protected async loadRoutes():Promise<void> {
        await this.loadRoutesFromRepo()
        await this.checkUIUpdateWithNoRepoStats();

        await this.loadRoutesFromApi()

        
        this.preloadDetails().then( ()=>{this.emitLists('loaded')})
        this.startSync()
    }

    protected async preloadDetails() {
        const {cards=[]} = this.searchRepo()

        const promises = []

        const loadDetails = (card):Promise<void> => {
            return this.db.getDetails( card.getId() )
            .then( details => { 
                card.setRouteData(details)

                const route = card.getData()
                if (!route.description.country) {
                    route.updateCountryFromPoints()
                        .then( ()=> {
                            this.db.save(route,false)
                        })
                }

            }) 
            .catch( ()=>{
                // ignore
            }) 

        }
        
        cards.forEach( card => {
            if (!card || promises.length>19)
                return;
            
            if (!card.getRouteData() ) {
                promises.push( loadDetails(card) )
            }
        })
        
        await Promise.allSettled( promises)


    }

    protected startSync() { 
        try {
            if (!this.syncInfo.iv) {
                // run sync every 5 minutes
                this.syncInfo.iv = setInterval( () => this.performSync(), this.getSyncFrequency())
                this.performSync()
            }
        }
        catch(err) {
            this.logError(err,'startSync')
        }
    }

    protected getSyncFrequency() {
        return this.getUserSettings().get('syncFrequency',SYNC_INTERVAL)
    }

    protected stopSync() { 
        if (!this.syncInfo.iv) 
            return;
    
        this.syncInfo.observer?.emit('stop')
        this.syncInfo.observer.stop()

        clearInterval(this.syncInfo.iv)
        this.syncInfo={}

    }

    protected async performSync(service?:string) {

        return new Promise<void>( done =>{
            const observer = this.getRouteSyncFactory().sync(service)
            if (!observer)
                done()

            this.observer.emit('sync-start')
            this.syncInfo.observer = observer
            const onAdded = this.onSyncRouteAdded.bind(this)
            const onUpdated = this.onSyncRouteUpdated.bind(this)
            const onDeleted = this.onSyncRouteDeleted.bind(this)

            observer.on('added',onAdded)
            observer.on('updated',onUpdated)    
            observer.on('deleted',onDeleted)    
            observer.once('done',()=>{
                delete this.syncInfo.observer
                this.observer.emit('sync-done')
                done()
            })

        })
    }

    protected async loadSyncedRouteDetails(route:Route):Promise<Route> {
        const syncProdider = this.getRouteSyncFactory().get(route.description.source)
        if (!syncProdider)
            return route
        
        try {
            const updated = await syncProdider?.loadDetails(route)
            this.db.save(updated,true)
            return updated
        }
        catch( err) {
            this.logError(err,'loadSyncedRouteDetails')
            return route
        }

    }

    protected onSyncRouteAdded( source:string, descriptions: Array<RouteInfo>) {
        descriptions.forEach( descr => {
            const route = new Route(descr)
            this.db.save(route) 
            this.addRoute(route,'system')
            this.logEvent({message:'route added', route:route.description.title, source})
        })
    }

    protected onSyncRouteUpdated( source:string, routes: Array<Route>) {
        const descriptions = routes.map( r=>r.description)

        descriptions.forEach( descr => {
            const route = new Route(descr)
            this.loadSyncedRouteDetails(route)
            this.update(route,'system')
            this.logEvent({message:'route updated', route:route.description.title, source})
        })

    }
    protected onSyncRouteDeleted( source:string, routes: Array<string>) {
        routes.forEach( id=> {
            const card = this.getCard(id)
            if (card) {
                card.delete({source:'system'})
                const description = card.getRouteDescription()
                this.logEvent({message:'route deleted', route:description?.title, source})
            }
        })

    }
    


    // In case a user already had  aprevious version of the UI installed and routes were in the DB, we need to initialize the "tsImported" field
    // with the current timestamp minus one minute. 
    // This will ensure that any new routes added to the repo will show up as "New" in the UI for those users, which otherwise would not happen
    protected async checkUIUpdateWithNoRepoStats() {
        const repoUpdate = this.getRepoUpdates();
        if (this.routes.length > 0 && repoUpdate.initial === undefined) {

            const ts = Date.now() - 60000;
            this.routes.forEach(r => {
                r.description.tsImported = ts;
                this.update(r);
            });
            this.updateRepoStats(ts);
            await sleep(5); // just to make sure that any following route import will have a different tsImported

        }
    }

    protected getRepoUpdates() {
        try {
            return getRepoUpdates();
        }
        catch  {         
            return {  };
        }
    }

    protected updateRepoStats(ts?:number) {
        updateRepoStats(ts);
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

        return new Promise<void> ( done => {
            const observer = this.api.load()
            const add = this.addFromApi.bind(this)
            const update = this.update.bind(this)

            observer.on('route.added',add)
            observer.on('route.updated',update)
            observer.on('done',done)
    
        })

    }


    protected async loadRouteDetails(route: Route, id: string) {
        route.details = await this.db.getDetails(id);

        // not in DB yet? must come from external app or API 
        if (!route.details) {

            if (route.description.source) {
                await this.loadSyncedRouteDetails(route);
            }
            else {                
                const target = [{route,added:false}]
                await this.api.loadDetails(target)
            }
        }

        // we could not load details, so just return
        if (!route.details) {
            return;
        }

        // fix: legacy items might have selectableSegments in root instead of in video
        if (route.description.hasVideo) {
            if (!route.details.video.selectableSegments && route.details.selectableSegments) {
                route.details.video.selectableSegments = route.details.selectableSegments;
                delete route.details.selectableSegments;
            }
        }
    }

    protected verifyRouteCountry(route: Route) {
        if (route.details && route.description && !route.description.country) {
            route.updateCountryFromPoints()
                .then(() => {
                    this.db.save(route, false);
                })
                .catch(err => {
                    this.logError(err,'verifyRouteCountry',{id:route.description.id, title:route.description.title})                    
                });
        }
    }



    protected selectList(route:Route):CardList<Route> {
        const description = route.description

        if (description.source) {
            return this.selectListForSource(route)
        }

        if (!description.hasVideo) {
            return this.selectListForGPX(route)
        }
        
        return this.selectListForVideo(route)
    }

    private selectListForGPX(route:Route):CardList<Route> {
        const description = route.description
        const category = description.category?.toLocaleLowerCase()

        if (category==='personal' || description.isLocal)
            return this.myRoutes

        if (description.category=='alternatives')
            return this.alternatives
        if (description.category=='selected')
            return this.selectedRoutes
        return description.category ? this.alternatives : this.selectedRoutes

    }

    private selectListForVideo(route:Route):CardList<Route> {
        const description = route.description
        const category = description.category?.toLocaleLowerCase()
        if (description.isLocal || description.isDownloaded)
            return this.myRoutes
        if (description.category=='selected')
            return this.selectedRoutes

        if (description.category=='alternatives' || description.isDemo || (description.requiresDownload && !description.isDownloaded))
            return this.alternatives

        if (category===undefined || category==='personal' || category==='imported')
            return this.myRoutes
        
        return this.selectedRoutes
      

    }
    private selectListForSource(route:Route):CardList<Route> {
        const description = route.description
        const {source} = description
        const name = this.getAppsService().getName(source)
        const existing = this.custom.find( l=>l.getTitle()===name)
        if (existing)
            return existing
        else {
            return this.addCustomList(source, name)
        }
    }


    private addCustomList(source:string,name:string) {
        const customList = new AlternativeRoutes(source,name)
        this.custom.push( customList)
        return customList
    }


    async createPreview( descr:RouteInfo) {

        try {
            const routesApi = IncyclistRoutesApi.getInstance() 
            const res = await Promise.allSettled([
                routesApi.getRoutePreview(descr.id),
                routesApi.getRoutePreview(descr.originalName||descr.title)
            ])

            const previewUrl = (res[0].status==='fulfilled' ? res[0].value:undefined) ?? 
                               (res[1].status==='fulfilled' ? res[1].value:undefined)
            if (previewUrl) {
                descr.previewUrl = previewUrl
                return;
            }

            this.logEvent({message:'preview not found',title:descr.originalName||descr.title, id: descr.id})


        }
        catch (err){
            this.logError(err,'createPreview')            
        }
        
        // As we would be overloading ffmpeg by creating multiple screenshots
        // at the same time, we are queueing the requests        
        return new Promise( done => {
            this.createPreviewQueue.push( {descr,done} )
            this.processPreviewQueue()
    
        })
    }

    protected async checkExistingPreviewFiles(descr:RouteInfo):Promise<string|undefined> {
        const videoUrl = descr.videoUrl || descr.downloadUrl
        const path = getBindings().path
        const fs = getBindings().fs

        let existingPreview:string
        let fileUrl = false
        try {
            let {dir,name} = path.parse(videoUrl)??{}
            if (!dir.startsWith('htttp')) {
                if (dir.startsWith('video:')) {                    
                    dir = dir.replace('video:', 'file:')                    
                }
                if (dir.startsWith('file:///')) {
                    dir = dir.replace('file:///','')
                    fileUrl = true
                }


                const check = async (name:string) => {
                    if (existingPreview)
                        return
                    if (await fs.existsFile( name))
                        existingPreview = name
                }

                await check(path.join( dir, 'preview.png'))
                await check(path.join( dir, 'preview.jpg'))
                await check(path.join( dir, `${name}_preview.png`))
                await check(path.join( dir, `${name}_preview.jpg`))

                if (existingPreview) {
                    this.logEvent({message:'found preview', title:descr.title, id:descr.id, video:videoUrl, existingPreview})
                    descr.previewUrl = fileUrl ? `file:///${existingPreview}` : existingPreview
                    return descr.previewUrl
                }

            }
        }
        catch {
            // ignore errors
        }

    }

    protected async doCreatePreview( descr:RouteInfo):Promise<string> {

        let props 
        const videoUrl = descr.videoUrl || descr.downloadUrl
        const previewUrl = descr.previewUrl

        if (valid(previewUrl))
            return previewUrl

        const appInfo = getBindings().appInfo
        const path = getBindings().path
        const fs = getBindings().fs
        
        const outDir = path.join( appInfo.getAppDir(),'previewImg')
        await fs.ensureDir(outDir)

        const existing = await this.checkExistingPreviewFiles(descr)
        if (existing)
            return existing

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

                this.logEvent({message:'creating preview failed', title:descr.title, id:descr.id, video:videoUrl, reason:err.message })
            }
        }

    }

    protected processPreviewQueue():PromiseObserver<void> {

        const run = async()=>{
            while ( this.createPreviewQueue.length>0) {

                const {descr,done} = this.createPreviewQueue.shift()
                
                const res = await this.doCreatePreview(descr)      
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
        
        try {
            let id:string;
            let legacyId;
            if (typeof target==='string') {
                id = target
            }
            else {
                const route = target
                id = route?.description?.id
                legacyId = route?.description?.legacyId
            }

            if (!id && !legacyId) {
                return;
            }


            let card =this.myRoutes.getCards().find(c=>c.getData()?.description?.id===id || c.getData()?.description?.legacyId===id ) as RouteCard
            if (card)
                return {card,list:this.myRoutes}

            if (legacyId) {
                const legacyCard =this.myRoutes.getCards().find(c=>c.getData()?.description?.id===legacyId ) as RouteCard
                if (legacyCard) {
                    this.myRoutes.remove(legacyCard)
                    const idx = this.routes.findIndex( r => r?.description?.id===legacyId && !r?.description?.isDeleted)
                    if (idx!==-1) {
                        this.routes.splice(idx,1)
                    }
                    return
                }
            }
        
            const lists = [this.selectedRoutes,this.alternatives, ...this.custom??[] ]         
            for (let list of lists) {
                card = list.getCards().find(c=>c.getData()?.description?.id===id) as RouteCard
                if (card)
                    return {card,list}
            }
        }
        catch (err) {
            this.logError(err,'findCard',{target})
        }
    }

    protected resetCards() {
        const lists = this.getLists()??[]

        lists.forEach( list=> {
            const cards = list.getCards()??[]
            cards.forEach( (card) => {
                card.reset(true)
               
            })
        })

    }

    protected getAllSearchCards() {
        const cards:Array<RouteCard> = []
        
        this.getLists(false)?.forEach( list=> {
            list.getCards().forEach( (card) => {
                if(!card)
                    return
                // filter out special cards
                if (card.getCardType()==='Import'||card.getCardType()==='Free-Ride'||card.getCardType()==='ActiveImport'  )
                    return;
                cards.push(card as RouteCard)
            })
        })
        return cards;

    }

    protected handleConfigChanges() {
        
        this.getAppsService().on('operation-enabled', (app,operation)=>{

            if (operation==='RouteDownload')
                this.performSync(app).then( ()=>{ 
                    this.emitLists('updated')
            })
        })
        this.getAppsService().on('operation-disabled', (app,operation)=>{
            if (operation==='RouteDownload')
                this.emitLists('updated')
        })

        


    }

    protected onRouteStatsUpdate(stats: ActiveRideCount[]) {

        this.stats = stats

        for ( const stat of stats) {
            const id = stat.routeId
            const card = this.getCard(id)
            if (card) {
                card.setActiveCount(stat.count)
            }
        }
     
    }

    @Injectable
    protected getUserSettings () {
        return useUserSettings()
    }

    @Injectable
    protected getRouteSyncFactory() {
        return new RouteSyncFactory()
    }

    @Injectable
    protected getAppState() {
        return useAppState()
    }


    @Injectable getAppsService() {
        return useAppsService()
    }

    @Injectable getUnitConverter() {
        return useUnitConverter()
    }

    reset() {
        super.reset()
        if (this.syncInfo?.iv ) {
            clearInterval(this.syncInfo.iv)
            this.syncInfo.iv = undefined
        }   
    }


}


export const useRouteList = ()=>new RouteListService()
export const getRouteList = ()=>new RouteListService()