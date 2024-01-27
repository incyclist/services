import { Card, CardList } from "../../base/cardlist";
import { IncyclistService } from "../../base/service";
import { IListService, ListObserver, Singleton } from "../../base/types";
import { PromiseObserver } from "../../base/types/observer";
import { Plan, Workout } from "../base/model/Workout";
import { WorkoutCard } from "./cards/WorkoutCard";
import { WorkoutImportCard } from './cards/WorkoutImportCard'
import { WorkoutsDbLoader } from "./loaders/db";

export type WP = Workout|Plan


@Singleton
export class WorkoutListService extends IncyclistService  implements IListService<Workout|Plan> { 

    protected myWorkouts: CardList<WP>;
    protected initialized:boolean
    protected observer: ListObserver<WP>
    protected preloadObserver: PromiseObserver<void>
    protected items: Array<WP>
    protected db: WorkoutsDbLoader

    constructor () {
        super('WorkoutList')    
        this.initialized = false;
        this.myWorkouts = new CardList<WP>('myWorkouts','My Workouts')
        this.db = new WorkoutsDbLoader()

        this.myWorkouts.add( new WorkoutImportCard() )

    }

    open():{observer:ListObserver<WP>,lists:Array<CardList<WP>> } {
        try {
            this.logEvent( {message:'open route list'})
            /*
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
            */
        }
        catch(err) {
            this.logError(err,'open')
        }
        return {observer: this.observer, lists:this.getLists() }
    }

    close(): void {
        
    }


    preload():PromiseObserver<void> {
        try {
            this.logEvent( {message:'preload route list'})
            if (!this.preloadObserver) {
                const promise = this.loadWorkouts()
                this.preloadObserver = new PromiseObserver<void>( promise )
    
                this.preloadObserver.start()
                    .then( ()=> { 
                        const cards = {                        
                            myRoutes:this.myWorkouts.length, 
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

    getLists(forUi:boolean=true):Array<CardList<WP>> {

        try {
            if (forUi && (!this.initialized))
                return null;

            const lists:Array<CardList<WP>> = [ this.myWorkouts ]

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
            
            const hash = lists ? lists.map( l=> l.getCards().map(c=>c.getId()).join(',')).join(':') : ''
            if (this.observer)
                this.observer.emit(event,lists,hash)
    
        }
        catch(err) {
            this.logError(err,'emitLists',event)

        }
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

    protected async loadWorkouts():Promise<void> {

        return new Promise<void> ( done => {
            const observer = this.db.load()
            const add = this.addItem.bind(this)
            const update = this.updateItem.bind(this)
    
            observer.on('route.added',add)
            observer.on('route.updated',update)
            observer.on('done',done)
    
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
        if ( list.getId()==='myWorkouts')
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
        // TODO: implement
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

    
    
}