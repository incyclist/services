import { FileInfo } from "../../api";
import { Card, CardList } from "../../base/cardlist";
import { IncyclistService } from "../../base/service";
import { IListService, ListObserver, Singleton } from "../../base/types";
import { PromiseObserver } from "../../base/types/observer";
import { useRouteList } from "../../routes";
import { useUserSettings } from "../../settings";
import { waitNextTick } from "../../utils";
import { valid } from "../../utils/valid";
import { Plan, Workout } from "../base/model/Workout";
import { WorkoutParser } from "../base/parsers";
import { ActiveImportCard } from "./cards/ActiveImportCard";
import { WorkoutCard } from "./cards/WorkoutCard";
import { WorkoutImportCard,WorkoutCreateCard } from './cards'
import { WorkoutSettings } from "./cards/types";
import { WorkoutsDbLoader } from "./loaders/db";
import { WP,WorkoutSettingsDisplayProps } from "./types";

/**
 * [WorkoutListService](WorkoutListService.md) is the service managing the business flows of the Workout List page and the Workout Area in the settings dialog
 * 
 * The service will take care of the following functionality
 * - provide the content for lists to be displayed on the page
 * - provide the content to be displyed in the Workout Setings dialog (i.e. dialog shown before staring a workout)
 * - manage selection/unselection and keep track of state
 * - provide capability to import workouts
 * - sync data with local databse
 * 
 * 
 * This service depends on
 *  - UserSettings Service  (to store and retrieve the default Workout settings in the user preferecce)
 *  - RouteList Service     (to check if a route has been selected)
 * 
 * @public
 * @noInheritDoc
 * 
 */
@Singleton
export class WorkoutListService extends IncyclistService  implements IListService<Workout|Plan> { 

    protected myWorkouts: CardList<WP>;
    protected lists: Array<CardList<WP>>
    protected initialized:boolean
    protected observer: ListObserver<WP>
    protected preloadObserver: PromiseObserver<void>
    protected items: Array<WP>
    protected db: WorkoutsDbLoader
    protected screenProps;    
    protected language:string
    protected selectedWorkout:Workout
    protected ftp:number


    constructor () {
        super('WorkoutList')    

        this.initialized = false;
        this.myWorkouts = new CardList<WP>('myWorkouts','My Workouts')
        this.lists = [this.myWorkouts]
        this.items = []

        this.language = 'en'

        this.myWorkouts.add( new WorkoutImportCard() )
        this.myWorkouts.add( new WorkoutCreateCard() )


        this.registerUserChangeHandler();
    }

    // Getters && Setters
    getSelected():Workout { return this.selectedWorkout }
    setScreenProps(props) {this.screenProps = props }
    getScreenProps() { return this.screenProps}
   
    /**
     * This method should be called by the Workout Page UI to receive the content to be displayed on the page
     * 
     * @returns observer: an Observer object that will be used to inform the UI about relevant changes, so that it can re-render
     * @returns lists: the content of the lists to be displayed
     * 
     * @emits started   observer just has been created
     * @emits loading   list is being loaded
     * @emits loaded    loading has been completed, provides lists as parameter
     * @emits updated   lists have been updated, provides lists as first parameter, provides a hash as 2nd paramter (allows UI to only refresh if hash has changed)
     * 
     * ``` typescript
     * // .... React Imports 
     * import {useWorkoutList} from 'incyclist-services';
     * 
     * const page = ()=> {
     *    const service = useWorkoutList()
     *    const [state,setState] = useState({})
     *    
     *    useRef( ()=>{
     *       if (state.initialized)
     *          return;
     * 
     *       const {observer,lists} = service.open()
     *       if (observer) {
     *          observer
     *              .on('started',()=>{ 
     *                  setState( current=> ({...current,lists,loading:false}))
     *               })
     *              .on('updated',(update)=>{
     *                  setState( current=> ({...current,lists:update,loading:false}))
     *               })
     *              .on('loading',()=>{
     *                  setState( current=> ({...current,loading:true}))
     *               })
     *              .on('loaded',(update)=>{
     *                  setState( current=> ({...current,lists:update,loading:false}))
     *               })
     *       }
     *       setState( {observer,lists,initialized:true})
     *    })
     *    
     *    if (!state?.lists?.length)
     *         retrurn <EmptyPage/>
     * 
     *    return ( 
     *       { !state?.lists.map( l=> 
     *              .... 
     *       }
     *    )
     * }
     * 
     * ```
     * 
     * 
     */

    open():{observer:ListObserver<WP>,lists:Array<CardList<WP>> } {

        let lists = null;
        try {
            this.logEvent( {message:'open workout list'})
            
            lists = this.getLists()

            //this.myWorkouts.removeActiveImports()
            this.resetLists()

            if (!this.observer) {
                this.observer = new ListObserver<WP>(this)
                this.emitStartEvent()
            }    

            // if preload has not been started yet, load data
            if (!this.initialized) {

                if (!this.preloadObserver)
                    this.preload()
                return  {observer: this.observer, lists:null }
            }
            
            waitNextTick().then ( ()=> {
                this.emitLists('updated')
            })            
        }
        catch(err) {
            this.logError(err,'open')
        }
        return {observer: this.observer, lists }
    }

    /**
     * This method should be called by the Workout Page UI when it closes the page
     *
     * all necessary cleanup activities will be done
     *  
     */
    // istanbul ignore next
    close(): void {
        // nothing to do        
    }

    /**
     * This method provides content and implements business logic for the Workout section in the Settings dialog
     * 
     * 
     * @returns observer: an Observer object that will be used to inform the UI about relevant changes, so that it can re-render
     * @returns workouts: the workouts to be displayed
     * @returns selected: the workout that was selected ( or currently is in use)
     * @returns settings: the settings to be used/currently being used for the workout
     * 
     * @emits started   observer just has been created
     * @emits loading   list is being loaded
     * @emits loaded    loading has been completed, provides lists as parameter
     *
     */
    openSettings(): WorkoutSettingsDisplayProps {

        let workouts:CardList<Workout>
        let settings:WorkoutSettings
        let selected: Workout
        try {
            this.logEvent( {message:'open workout settings'})

            if (!this.observer) {
                this.observer = new ListObserver<WP>(this)
                this.emitStartEvent()
            }    

            if (!this.initialized) {

                if (!this.preloadObserver)
                    this.preload()
                return  {observer: this.observer, workouts:null }
            }

            workouts = this.createSettingsList() as CardList<Workout>
            selected = this.getSelected()
            settings = this.getStartSettings()

        }
        catch(err) {
            this.logError(err,'openSettings')
        }

        return {observer:this.observer, workouts,selected,settings}

    }

    /**
     * returns the Settings ( FTP and forced ERGMode on/off) for the workout
     * 
     * @returns {WorkoutSettings} the settings that will be applied once a workout will be started/resumed
     */
    getStartSettings():WorkoutSettings {
        let ftp:number=this.ftp??200
        let useErgMode:boolean=true

        try {
            const userSettings = this.getUserSettings()
        
            useErgMode = userSettings.get('preferences.useErgMode',true)       
            const user= userSettings.get('user',undefined)
            ftp = this.ftp ?? user?.ftp ??  200
        }
        catch(err) {
            this.logError(err,'getStartSettings')
        }
        return {ftp,useErgMode}
    }

    /**
     * changes the Settings ( FTP and forced ERGMode on/off) for the workout
     * 
     * The FTP will overrule the FTP from the user settings, 
     * unless the FTP is changed in the user settings. In that case, the new value from the user settings will be taken
     * 
     * @param settings  new settings to be applied
     */
    setStartSettings(settings:WorkoutSettings):void {
        try {
            const userSettings = this.getUserSettings()        
            userSettings.set('preferences.useErgMode',settings?.useErgMode)
            this.ftp = settings?.ftp
        }
        catch(err) {
            this.logError(err,'setStartSettings')   
        }
    }


    /**
     * handles the UI resize event
     * 
     * should be called everytime the UI needs to resize
     * As a resize triggers a re-render of the carousels, this will make the cards invisible (to speed up rendering)
     * 
     */
    onResize() {
        try {
            this.resetCards()
        }
        catch(err) {
            this.logError(err,'onResize')
        }

    }

    /**
     * is called by the carousel, when initial rendering of a carousel has been done
     * 
     * this will change all cards "within the fold" to visible, which will trigger re-rendering of these cards (not the whole carousel)
     * also the next 2 cards will be made visible, so that immediate scrolling will not deliver empty divs
     * 
     * after 1s all other cards will be made visible
     * 
     */
    onCarouselInitialized(list:CardList<WP>, item,itemsInSlide):void {
        // istanbul ignore next
        if (list===undefined || list===null)
            return;

        try {
            const cards = list.getCards()??[]
            cards.forEach( (card,idx) => {
                card.setInitialized(true)
                if (idx<item+itemsInSlide+2) {

                    card.setVisible(true)
                }
            })
            setTimeout( ()=>{ this.onCarouselUpdated(list,item,itemsInSlide)}, this.getInitTimeout())
        }
        catch(err) {
            this.logError(err,'onCarouselInitialized')
        }
        
    }

    /**
     * is called by the carousel, when carousel has been updated
     * 
     * all cards will be made visible
     * 
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onCarouselUpdated(list,item,itemsInSlide) {
        try {
            const cards = list.getCards()??[]
            cards.forEach( (card,idx) => {
                if (idx>=item && idx<item+itemsInSlide+10 && !card.isVisible()) {

                    card.setVisible(true)
                }
            })
        }
        catch(err) {
            this.logError(err,'onCarouselUpdated')
        }

    }



    /**
     * triggers the loading of the workouts from repo/api
     * 
     * this method will be called internally when [[open]] or [[openSettings]] will be called
     * 
     * However, it should also be called by the UI as soon as possible to reduce loading time for the user
     * 
     * @returns observer to signal events that mith require re-render
     * @emits loading   list is being loaded
     * @emits loaded    loading has been completed, provides lists as parameter
     */

    preload():PromiseObserver<void> {
        try {
            this.logEvent( {message:'preload workout list'})
            this.emitLoadingEvent()

            if (!this.preloadObserver) {
                const promise = this.loadWorkouts()
                this.preloadObserver = new PromiseObserver<void>( promise )
    
                this.preloadObserver.start()
                    .then( ()=> { 
                        const cards = {                        
                            myRoutes:this.myWorkouts.length, 
                        }
                        this.logEvent( {message:'preload workout list completed',cards})
                        this.initialized = true
                        this.emitLists('loaded')
                        process.nextTick( ()=>{delete this.preloadObserver})
                    })
                    .catch( (err)=> {
                        this.logError(err,'preload')
                        process.nextTick( ()=>{delete this.preloadObserver})
                    })
            }
    
    
        }
        catch(err) {
            this.logError(err,'preload')
        }
        return this.preloadObserver
    }

    isStillLoading():boolean {
        return this.preloadObserver!==undefined && !this.initialized
    }


    /**
     * perform an import of one or multiple workout file(s) from disk or URL
     * 
     * This method will not only perform the actual import, but also has implemented business logic to give the user feedback 
     * - Adding an [[ActiveImportCard]] while import is in progress
     * - Adding a card for the imported workout(s) 
     * - Removing the [[ActiveImportCard]] in case the import was successfull
     * - Updating the [[ActiveImportCard]] with error information in case the import has failed
     * 
     * @param info  provides information on the source of the file(s) to be imported
     * @param props.card  In case of a retry, contains the [[ActiveImportCard]] that shows the previous import
     * @param props.showImportCards  flag that indicates if [[ActiveImportCard]] should be shown ( default=true)
     * 
     * @emits updated   list has been updated
     */

    async import( info:FileInfo|Array<FileInfo>, props:{ card?:ActiveImportCard, showImportCards?:boolean}):Promise<WorkoutCard[]> {
        
        try {
            const {card,showImportCards=true} = props??{}
            const files = Array.isArray(info) ? info : [info]

            const importCards: Array<ActiveImportCard> = showImportCards ? this.addImportCards(card, files) : []

            const doImport = async (file,idx) => {
                // istanbul ignore next
                if (!file)
                    return;


                const importCard = showImportCards ? importCards[idx] : null
                try {
                    const imported = await this._import(file)                                
                    this.myWorkouts.remove(importCard)
                    this.emitLists('updated')     
                   
                    return imported;
                }
                catch(err) {
                    if (importCard)
                        importCard.setError(err)
                    else 
                        throw err
                }

            }

            const promises = []
            files.forEach( async (file,idx)=>{
                promises.push( doImport(file,idx))                
            })

            const res = await Promise.allSettled(promises)

            if (!showImportCards) {            
                const rejected = res.filter( pr => pr.status==='rejected') as Array<PromiseRejectedResult>
                if (rejected?.length>0) {
                    throw (rejected[0].reason)                    
                }
            }

            return res.map( pr => {
                if (pr.status==='fulfilled') {
                    return pr.value
                }
                else {
                    return null
                }
            }
            ).filter( r=>!!r) as Array<WorkoutCard>
    

        }
        catch(err) {
            if (props?.showImportCards===false)
                throw err

            this.logError(err,'import',info)
            return []
        }
    }


    addList(name:string):CardList<WP> {
        const cnt = this.lists.length;
        const list = new CardList<WP>( `${cnt}:${name}`, name)
        this.lists.push(list)
        return list
    }

    

    getLists(forUi:boolean=true):Array<CardList<WP>> {

        try {
            if (forUi && (!this.initialized))
                return null;

            const lists = this.lists.filter( l=>l.getCards().length>0)

            // TODO Add additional Lists (Plans, e.g.)

            return lists

        }
        catch(err) {
            this.logError(err,'getLists')
            return [ this.myWorkouts]
        }

    }

    
    emitLists( event:'loaded'|'updated') {

        try {
            const lists = this.getLists()
            
            const hash = lists ? lists.map( l=> l.getCards().map(c=>c.getId()).join(',')).join(':') : '';           
            
            if (this.observer) {
                this.observer.emit(event,lists,hash)
            }
    
        }
        catch(err) {
            this.logError(err,'emitLists',event)

        }
    }


    unselect() {
        this.selectedWorkout = null    
    }

    select(workout:WP) {
        if (workout.type==='workout')
            this.selectedWorkout = workout as unknown as Workout
    }

    
    selectCard(card:Card<WP>) {
        if (this.selectedWorkout) {
            const selectedCard = this.findCard(this.selectedWorkout)?.card
            if (selectedCard)
                selectedCard.unselect()
        }
        this.select(card.getData())
        
    }
    unselectCard(card:Card<WP>) {
        if ( this.selectedWorkout?.id === card.getData().id)
            this.unselect()
    }

    moveCard( card:Card<WP>, source:CardList<WP>, target:string|CardList<WP>):CardList<WP> {
        try {
         
            let targetList:CardList<WP>
            if (typeof target==='string') {
                targetList = this.lists.find( l=>l.getTitle()===target)
                if (!targetList)
                    return;
            }
            else {
                targetList = target
            }

            source.remove(card)
            targetList.add(card)

            this.emitLists('updated')                
            return targetList
    
        }
        catch(err) {
            this.logError(err,'moveCard')
        }
        
    }

    canDisplayStart(): boolean {
        const routes = this.getRouteList()
        return valid(routes.getSelected())
    }

    protected createSettingsList(): CardList<WP> {
        const list = new CardList<Workout>('settings', 'Workouts')
        list.add(new WorkoutImportCard())

        this.items
            .sort( (a,b)=> a.name>b.name ? 1: -1)
            
        this.items.forEach( i=> {
            if (i.type==='workout') {
                const card = new WorkoutCard( i as Workout,{list})
                list.add(card)
            }
        })

        return list;
    }


    protected resetLists() {
        this.getLists(false)?.forEach( list=> {
            list.getCards()?.forEach( (card,idx) => {
                card.setInitialized(false)
                if (idx>0)
                    card.setVisible(false)
            })
        })
    }

    protected resetCards() {
        const lists = this.getLists(false)??[]

        lists.forEach( list=> {
            const cards = list.getCards()??[]
            cards.forEach( (card) => {
                card.reset()
            })
        })

    }

    protected async loadWorkouts():Promise<void> {

        return new Promise<void> ( (done,reject) => {
            try {
                const observer = this.getRepo().load()
                const add = this.addItem.bind(this)
                const update = this.updateItem.bind(this)

                observer.on('workout.added',add)
                observer.on('workout.updated',update)
                observer.on('done',done)
    
            }
            catch(err) {
                reject(err)
            }
        })

    }
    
    protected addItem(item:WP):Card<WP> {       
        const list = this.selectList(item)

        let card;
        if (item.type==='workout') {            
            card = new WorkoutCard(item as unknown as Workout,{list: list as CardList<Workout>})       
        }
        else if (item.type==='plan') {
            // TODO
        }

        list.add( card)
        
        card.enableDelete(true)    
        this.items.push(item)
        
        this.emitLists('updated')                
        return card;
    }

    protected async updateItem(item:WP):Promise<void> { 
        const existing = this.findCard(item)
        if (existing) {       

            if (item.type==='workout') {
                const workout = item as unknown as Workout
                const card = existing.card as unknown as WorkoutCard
                card.update(workout)
            }
            else if (item.type==='plan') { 
                // TODO
            }
        }
    }


    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    protected selectList(item:WP):CardList<WP> { 
        
        if (item.type==='workout') {
            const workout = item as unknown as Workout
            const category = workout.category?.name

            if (category) {
                const existingLists = this.getLists(false)??[]
                let list = existingLists.find( l=>l.getTitle()===category)
                if (list)
                    return list

                list = this.addList(category)
                return list
            }
        }
        else if (item.type==='plan') { 
            // TODO
        }

        return this.myWorkouts
    }


    protected findCard(target:WP|string):{ card:Card<WP>, list:CardList<WP>} {
        
        let id:string;
        
        if (typeof target==='string') {
            id = target
        }
        else {
            const item = target
            id = item.id            
        }

        let res;
        const lists = this.getLists(false)||[]

        lists.forEach( list => {
            if (res)
                return;

            const card =list.getCards().find(c=>c.getData()?.id===id) as WorkoutCard
            if (card)
                res= {card,list:this.myWorkouts}
    
        })
    
        return res;
    }

    protected addImportCard(file:FileInfo):ActiveImportCard {

        const card = new ActiveImportCard(file)


        //this.myWorkouts.addImport(card)
        const cards = this.myWorkouts.getCards();
        if (!cards)
            return;

        const idx = cards.findIndex(c=> c.getCardType() ==='Workout')
        if (idx===-1)
            cards.push(card)
        else 
            cards.splice( idx,0,card)

        this.emitLists('updated')                
        return card

    }

    protected async _import( info:FileInfo):Promise<WorkoutCard> {
            
        const workout = await this.parse(info)              
        const existing = this.findCard(workout)

        if (existing ) {   
            existing.list.remove( existing.card)
        }
        else  {
            this.items.push(workout)
        }
            
        const card = new WorkoutCard(workout,{list:this.myWorkouts as CardList<Workout>})
        card.save()
        card.enableDelete(true)
        
        this.myWorkouts.add( card )
        return card
    }

    protected async parse(info:FileInfo):Promise<Workout>{
        return await WorkoutParser.parse(info)

    }



    protected addImportCards(retry: ActiveImportCard, files: FileInfo[]) {
        const importCards: Array<ActiveImportCard> = [];

        if (!retry) {
            files.forEach((file) => {
                if (!file)
                    return;

                const card = this.addImportCard(file);
                importCards.push(card);
                this.emitLists('updated');
            });
        }
        else {
            importCards.push(retry);
        }
        return importCards;
    }

    protected registerUserChangeHandler() {
        const userSettings = this.getUserSettings();
        if (userSettings) {
            const observer = userSettings.requestNotifyOnChange('workouts', 'user');
            observer?.on('changed', (update)=>{
                this.onUserUpdate(update)                
            } );
        }
    }

    protected onUserUpdate( update) {
        
        if (this.ftp!==update?.ftp && valid(update?.ftp))                                
            this.ftp =update.ftp;
        
    }



    protected emitStartEvent()  {
        process.nextTick( ()=>{    
            this.observer?.emit('started')
        })
        
    }
    protected emitLoadingEvent()  {
        process.nextTick( ()=>{    
            this.observer?.emit('loading')
        })
        
    }

    protected emitLoadedEvent()  {
        process.nextTick( ()=>{
            this.emitLists('loaded')
        })
    }

    // istanbul ignore next
    protected getUserSettings()  {
        return useUserSettings() 
    }
    // istanbul ignore next
    protected getRouteList()  {
        return useRouteList()
    }

    // istanbul ignore next
    protected getInitTimeout():number {
        return 1000;
    }

    // istanbul ignore next
    protected getRepo() {
        if (!this.db)
            this.db = new WorkoutsDbLoader()
        return this.db
    }




   
}

export const useWorkoutList = ()=> new WorkoutListService()
export const getWorkoutList = ()=> new WorkoutListService()
