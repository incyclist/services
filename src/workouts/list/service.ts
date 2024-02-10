import { FileInfo } from "../../api";
import { Card, CardList } from "../../base/cardlist";
import { IncyclistService } from "../../base/service";
import { IListService, ListObserver, Singleton } from "../../base/types";
import { PromiseObserver } from "../../base/types/observer";
import { getRouteList } from "../../routes";
import { useUserSettings } from "../../settings";
import { valid } from "../../utils/valid";
import { Plan, Workout } from "../base/model/Workout";
import { WorkoutParser } from "../base/parsers";
import { ActiveImportCard } from "./cards/ActiveImportCard";
import { WorkoutCard } from "./cards/WorkoutCard";
import { WorkoutImportCard } from './cards/WorkoutImportCard'
import { WorkoutSettings } from "./cards/types";
import { WorkoutsDbLoader } from "./loaders/db";
import { WP } from "./types";

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
    protected startSettings:WorkoutSettings


    constructor () {
        super('WorkoutList')    
        this.initialized = false;
        this.myWorkouts = new CardList<WP>('myWorkouts','My Workouts')
        this.lists = [this.myWorkouts]
        this.db = new WorkoutsDbLoader()
        this.items = []

        this.myWorkouts.add( new WorkoutImportCard() )

    }

    // Getters && Setters
    setLanguage(language:string) {this.language = language}
    getLanguage():string {return this.language}
    getSelected():Workout { return this.selectedWorkout }
    setScreenProps(props) {this.screenProps = props }
    getScreenProps() { return this.screenProps}

    getStartSettings():WorkoutSettings { 
        if (!this.startSettings) {
            this.initStartSettings()
        }
        return this.startSettings
    }
    setStartSettings(settings:WorkoutSettings) {
        this.startSettings =settings
        this.updateStartSettings()
    }
    

    open():{observer:ListObserver<WP>,lists:Array<CardList<WP>> } {
        try {
            this.logEvent( {message:'open workout list'})
            
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

            //this.myWorkouts.removeActiveImports()
            this.resetLists()

            // selection already ongoing, return existing observer
            if (!this.observer) {
                this.observer = new ListObserver<WP>(this)
                emitStartEvent()
            }    

            // if preload has not been started yet, load data
            if (!this.initialized && !this.preloadObserver) {
                this.preload()
            }
            
            if (this.initialized && !hasLists)
                emitLoadedEvent()
            else 
                this.emitLists('updated')

            
        }
        catch(err) {
            this.logError(err,'open')
        }
        return {observer: this.observer, lists:this.getLists() }
    }

    openSettings(): {observer:ListObserver<WP>,workouts:CardList<Workout> } {

        let workouts:CardList<Workout>
        try {
            this.logEvent( {message:'open workout settings'})
            const emitStartEvent = async()=> {
                process.nextTick( ()=>{    
                    this.observer?.emit('started')
                })
                
            }

            if (!this.observer) {
                this.observer = new ListObserver<WP>(this)
                emitStartEvent()
            }    

            if (!this.initialized && !this.preloadObserver) {
                this.preload()
            }

            /*
            const items = this.items??[]
            workouts = items
                .filter(i=>i.type==='workout')
                .sort( (a,b) => a.name>b.name ? 1: -1)
                */

            workouts = this.createSettingsList() as CardList<Workout>
        }
        catch(err) {
            this.logError(err,'openSettings')
        }

        console.log('~~~ returning',{observer:this.observer, workouts})
        return {observer:this.observer, workouts}

    }

    close(): void {
        
    }

    onResize() {
        try {
            this.resetCards()
        }
        catch(err) {
            this.logError(err,'onResize')
        }

    }

    onCarouselInitialized(list:CardList<WP>, item,itemsInSlide) {
        try {
            list.getCards().forEach( (card,idx) => {
                card.setInitialized(true)
                if (idx<item+itemsInSlide+2) {

                    card.setVisible(true)
                }
            })
            setTimeout( ()=>{ this.onCarouselUpdated(list,item,itemsInSlide)}, 1000)
        }
        catch(err) {
            this.logError(err,'onCarouselInitialized')
        }
        
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onCarouselUpdated(list,item,itemsInSlide) {
        try {
            list.getCards().forEach( (card,idx) => {
                if (idx>=item && idx<item+itemsInSlide+10 && !card.isVisible()) {

                    card.setVisible(true)
                }
            })
        }
        catch(err) {
            this.logError(err,'onCarouselUpdated')
        }

    }




    preload():PromiseObserver<void> {
        try {
            this.logEvent( {message:'preload workout list'})
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
                    })
            }
    
    
        }
        catch(err) {
            this.logError(err,'preload')
        }
        return this.preloadObserver
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
                
            
                try {

                    const workout = await WorkoutParser.parse(file)              
                    const existing = this.findCard(workout)
    
                    if (existing ) {   
                        existing.list.remove( existing.card)
                    }
                    else  {
                        this.items.push(workout)
                    }
                        
                    const card = new WorkoutCard(workout,{list:this.myWorkouts as CardList<Workout>})
                    card.save()
                    card.enableDelete()
                    
                    this.myWorkouts.add( card )

                    this.myWorkouts.remove(importCard)
                    card.enableDelete(true)              
                    this.emitLists('updated')     
                   
                }
                catch(err) {
                    importCard.setError(err)
                }
        
                
            })
    

        }
        catch(err) {
            this.logError(err,'import',info)
        }
    }

    async importSingle( info:FileInfo):Promise<Workout> {
            
        const workout = await WorkoutParser.parse(info)              
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
        return workout
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

        

            // TODO Add additional Lists (Plans, e.g.)
            const lists = this.lists.filter( l=>l.getCards().length>0)
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
            source.remove(card)
            let targetList:CardList<WP>
            if (typeof target==='string') {
                targetList = this.lists.find( l=>l.getTitle()===target)
                if (!targetList)
                    return;
            }
            else {
                targetList = target as CardList<WP>
            }
            targetList.add(card)
            
            this.emitLists('updated')                
            return targetList
    
        }
        catch(err) {
            this.logError(err,'moveCard')
        }
        
    }

    canDisplayStart(): boolean {
        const routes = getRouteList()
        return valid(routes.getSelected())
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
        this.getLists().forEach( list=> {
            list.getCards().forEach( (card) => {
                card.reset()
            })
        })

    }

    protected async loadWorkouts():Promise<void> {

        return new Promise<void> ( (done,reject) => {

            
            try {
                const observer = this.db.load()
                const add = this.addItem.bind(this)
                const update = this.updateItem.bind(this)

                observer.on('workout.added',add)
                observer.on('workout.updated',update)
                observer.on('done',done)
    
            }
            catch(err) {
                reject(err)
                console.log('~~~ ERROR',err)
            }
    
    
        })

    }


    
    protected addItem(item:WP):void {       
        const list = this.selectList(item)

        let card;
        if (item.type==='workout') {            
            card = new WorkoutCard(item as unknown as Workout,{list: list as CardList<Workout>})       
        }
        else {
            // TODO
        }

        list.add( card)
        //if ( list.getId()==='myWorkouts')
            card.enableDelete(true)    
        this.items.push(item)
        
        this.emitLists('updated')                
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
            const item = target as WP
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

    protected initStartSettings() {
        const userSettings = useUserSettings()
        
        const useErgMode = userSettings.get('preferences.useErgMode',true)       
        const ftp = userSettings.get('user',undefined)?.ftp
        this.startSettings = {ftp,useErgMode}
    }

    protected updateStartSettings() {
        const userSettings = useUserSettings()        
        userSettings.set('preferences.useErgMode',this.startSettings?.useErgMode)
    }

    createSettingsList(): CardList<WP> {
        const list = new CardList<Workout>('settings', 'Workouts')
        list.add(new WorkoutImportCard())
        const sorted = this.items
            .sort( (a,b)=> a.name>b.name ? 1: -1)
        sorted.forEach( i=> {
            if (i.type==='workout') {
                const card = new WorkoutCard( i as Workout,{list})
                list.add(card)
            }
        })

        return list;
    }


   
}

export const useWorkoutList = ()=> new WorkoutListService()
export const getWorkoutList = ()=> new WorkoutListService()
