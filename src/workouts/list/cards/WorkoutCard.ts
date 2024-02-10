import { EventLogger } from "gd-eventlog";
import { Card, CardList } from "../../../base/cardlist";
import { Observer, PromiseObserver } from "../../../base/types/observer";
import { Workout } from "../../base/model/Workout";
import { BaseCard } from "./base";
import { WorkoutCardType, WorkoutSettings } from "./types";
import { WorkoutsDbLoader } from "../loaders/db";
import { useUserSettings } from "../../../settings";
import { getWorkoutList, useWorkoutList } from '../service'
import { waitNextTick } from "../../../utils";
import { Segment} from "../../base/model/Segment";
import { valid } from "../../../utils/valid";

export class WorkoutCard extends BaseCard implements Card<Workout> {

    protected workout: Workout
    protected logger:EventLogger
    protected deleteable:boolean 
    protected list:CardList<Workout>
    protected cardObserver = new Observer()
    protected deleteObserver

    constructor(workout:Workout, props?:{list?: CardList<Workout>} ) {
        super()
        const {list} = props||{};

        this.workout = workout
        this.list = list
        this.deleteable = false;

        this.initialized = false;
        this.logger = new EventLogger('WorkoutCard')
    }

    openSettings() {

        let settings,canStart,duration,ftpRequired,categories=[],category

        try {
            const service = useWorkoutList()

            canStart = service.canDisplayStart()
            duration = this.calculateDuration()

            ftpRequired = valid(this.workout.steps.find( s=> 
                (s.type=='step' && s.power?.type==='pct of FTP') ||
                (s.type=='segment' && (s as Segment)?.steps.find( s=> 
                    (s.type=='step' && s.power?.type==='pct of FTP'))
                )))

            settings = service.getStartSettings()
            categories = (service.getLists()??[]).map(l=>l.getTitle())
            category = this.list.getTitle()
            
        }
        catch(err) {
            this.logError(err,'openSettings')
        }
        return {settings, ftpRequired, canStart,duration,categories,category} 
    }


    select(settings?:WorkoutSettings) {
        const service = getWorkoutList()
        
        service.selectCard(this)
        if (settings)
            service.setStartSettings(settings)

        this.emitUpdate()
    }

    unselect() {
        const service = getWorkoutList()
        service.unselect()
        this.emitUpdate()
    }

    move(targetListName:string) {
        if (!targetListName?.length)
            return;

        const service = getWorkoutList()
        const newList = service.moveCard(this,this.list,targetListName)
        if (newList)
            this.list = newList as CardList<Workout>

        this.workout.category = {name:targetListName,index:newList?.length}
        this.save()
    }

    async save():Promise<void> {
        try {
            return await this.getRepo().save(this.workout)        
        }
        catch(err) {
            this.logError(err,'save')
        }
        
    }

    setList(list:CardList<Workout>) {
        this.list = list
    }

    delete(): PromiseObserver<boolean> {
        try {

            const service = getWorkoutList()
            service.unselectCard(this)

            // already deleting
            if (this.deleteObserver)
                return this.deleteObserver

            this.deleteObserver = new PromiseObserver< boolean> ( this._delete() )
            return this.deleteObserver
        }
        catch(err) {
            this.logError(err,'delete')
        }
    }

    protected async _delete():Promise<boolean> {

        // let the caller of delete() consume an intialize the observer first
        await waitNextTick()
        let deleted:boolean = false

        try {

            this.deleteObserver.emit('started')
            this.emitUpdate()

            if ( this.list.getId()==='myWorkouts') {
                await this.getRepo().delete(this.workout) 
            }
            else {
                //TODO
            }

            
            // remove from list in UI
            this.deleteFromUIList();
    


            getWorkoutList().emitLists('updated');
            deleted =true;   
        }
        catch(err) {
            deleted =  false
        }
        finally {
            this.deleteObserver.emit('done',deleted)
            waitNextTick().then( ()=> { 
                delete this.deleteObserver
                this.emitUpdate()
            })

        }

        

        return deleted

    }    

    getId(): string {
        return this.workout.id
    }

    update(workout:Workout) {
        try {
            this.workout = workout
            this.save()
            this.emitUpdate()
        }
        catch(err) {
            this.logError(err,'update')
        }
    }


    getData(): Workout {
        return this.workout
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    setData(data: Workout) {
        try {
            this.workout = data
        }
        catch(err) {
            this.logError(err,'setData')
        }

    }

    getCardType():WorkoutCardType {
        return "Workout"
    }
    getDisplayProperties() {
        const userSettings = useUserSettings()
        const user = userSettings.get('user',{})

        const duration = this.calculateDuration()

        return {title:this.workout.name,workout:this.workout,ftp:user?.ftp, duration, 
                canDelete:this.deleteable, visible:this.visible, selected:this.isSelected(),
                observer: this.cardObserver}
    }

    enableDelete(enabled:boolean=true) {
        this.deleteable = enabled
    }

    canDelete() {
        return this.deleteable
    }

    setVisible(visible: boolean): void {
        try {
            const prev = this.visible
            this.visible = visible
            if (visible!==prev)
                this.emitUpdate()
        }
        catch(err) {
            this.logError(err,'setVisible')
        }
    
    }


    protected calculateDuration():string {
        const {duration} = this.workout

        if ( duration<120)
            return `${duration.toFixed(0)}s`

        if ( duration%60 ===0 )
            return `${duration/60}min`

        const secVal = duration %60
        const minVal = (duration-secVal)/60 %60        
        const h = Math.floor((duration-secVal-minVal*60)/3600)

        const sec = secVal<10 ? `0${secVal}` : secVal
        const min = minVal<10 ? `0${minVal}` : minVal
        if (h>0)
            return `${h}:${min}:${sec}`
        else 
            return `${min}:${sec}`
    }


    protected deleteFromUIList() {
        if (this.list) {
            this.list.remove(this);
        }
    }

    protected logError( err:Error, fn:string) {
        this.logger.logEvent({message:'error', error:err.message, fn, stack:err.stack})
    }

    protected getRepo() {
        return new WorkoutsDbLoader()
    }

    protected emitUpdate() {
        if (this.cardObserver)
            this.cardObserver.emit('update', this.getDisplayProperties())
    }

    protected isSelected():boolean {
        const service = getWorkoutList()
        const selectedWorkout = service.getSelected()
        if (selectedWorkout?.id===this.workout.id)
            return true;
    }



}