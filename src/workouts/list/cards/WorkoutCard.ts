import { EventLogger } from "gd-eventlog";
import { Card, CardList } from "../../../base/cardlist";
import { Observer, PromiseObserver } from "../../../base/types/observer";
import { Workout } from "../../base/model/Workout";
import { BaseCard } from "./base";
import { WorkoutCardDisplayProperties, WorkoutCardType, WorkoutSettings, WorkoutSettingsDisplayProps } from "./types";
import { WorkoutsDbLoader } from "../loaders/db";
import { useUserSettings } from "../../../settings";
import { getWorkoutList, useWorkoutList } from '../service'
import { waitNextTick } from "../../../utils";
import { Segment} from "../../base/model/Segment";
import { valid } from "../../../utils/valid";

/**
 * [WorkoutCard](WorkoutCard.md) objects are used to represent a single workout in the workout list
 * 
 * @public
 * @noInheritDoc
 */

export class WorkoutCard extends BaseCard implements Card<Workout> {

    protected workout: Workout
    protected logger:EventLogger
    protected deleteable:boolean 
    protected list:CardList<Workout>
    protected cardObserver = new Observer()
    protected deleteObserver

    /**
     * Creates a new WorkoutCard object
     * 
     * @param workout The workout to be represented by this card
     * @param props.list The list that cntains the card 
     */
    constructor(workout:Workout, props?:{list?: CardList<Workout>} ) {
        super()
        const {list} = props||{};

        this.workout = workout
        this.list = list
        this.deleteable = true;

        this.initialized = false;
        this.logger = new EventLogger('WorkoutCard')
    }

    /**
     * should be called by the UI, when the Workout Settings (Details Dialog will be shown)
     * 
     * This class will manage the state and will return the information that is required
     * to render the Dialog
     * 
     */
    openSettings():WorkoutSettingsDisplayProps {

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

            settings = service.getStartSettings()??{}
            

            categories = (service.getLists()??[]).map(l=>l.getTitle())
            category = this.list.getTitle()
            
        }
        catch(err) {
            this.logError(err,'openSettings')
        }
        return {settings, ftpRequired, canStart,duration,categories,category} 
    }


    /**
     * marks the workout as selected
     * 
     * This workout should then be used during the next ride
     * 
     * @emits update  Update is fired, so that card view can refresh ( to update select state)
     */
    select(settings?:WorkoutSettings):void {
        const service = getWorkoutList()
        
        service.selectCard(this)
        if (settings)
            service.setStartSettings(settings)

        this.emitUpdate()
    }

    /**
     * marks the workout as _not_ selected
     * 
     * @emits update  Update is fired, so that card view can refresh ( to update select state)
     */
    unselect() {
        const service = getWorkoutList()
        service.unselect()
        this.emitUpdate()
    }

    /**
     * moves the workout into a different list
     * 
     * this change will also be represented in the _category_ member and the workout will be updated in the local database
     * 
     * @param targetListName name of the list the card should be added to
     */
    move(targetListName:string):void {
        if (!targetListName?.length)
            return;

        const service = getWorkoutList()
        const newList = service.moveCard(this,this.list,targetListName)
        if (newList) {
            this.list = newList as CardList<Workout>
        }
        this.workout.category = {name:targetListName,index:newList?.length}

        this.save()
    }

    /**
     * saves the workout into the local database
     */
    async save():Promise<void> {
        try {
            return await this.getRepo().save(this.workout)        
        }
        catch(err) {
            this.logError(err,'save')
        }
        
    }

    /**
     * deletes the workout from display and database
     * 
     * In case the workout was currently selected, it will unselect it before deleting
     */
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


    /**
     * returns a unique ID of the workout
     * 
     * @returns unique ID
     */
    getId(): string {
        return this.workout.id
    }

    /**
     * returns the title of the card 
     * 
     * @returns the name of the workout
     */
    getTitle(): string {
        return this.workout.name
    }
    

    /**
     * updates the content of the card
     * 
     * The card content will be changed and the updated workout will be saved in the the local database
     * 
     * @param workout The update workout
     * 
     * @emits update event to trigger re-rendering of card view
     */
    update(workout:Workout) {
        // istanbul ignore next
        if (!valid(workout))
            return

        try {
            this.workout = workout
            this.save()
            this.emitUpdate()
        }
        catch(err) {
            this.logError(err,'update')
        }
    }


    /**
     * returns the workout that is represented by this card
     * 
     * @returns The workout represented by this card
     */
    getData(): Workout {
        return this.workout
    }

    /**
     * returns type of this card
     * 
     * @returns always will be 'Workout'
     */
    getCardType():WorkoutCardType {
        return "Workout"
    }


    /**
     * returns the information required to render a card in the Workout list
     * 
     */
    getDisplayProperties():WorkoutCardDisplayProperties {
        const userSettings = useUserSettings()
        let user
        try {
            user = userSettings.get('user',{})
        } catch {
            user = {}
        }

        const duration = this.calculateDuration()

        return {title:this.workout.name,workout:this.workout,ftp:user?.ftp, duration, 
                canDelete:this.deleteable, visible:this.visible, selected:this.isSelected(),
                observer: this.cardObserver}
    }

    /**
     * enables/disables deletion of the workout
     * 
     * @param [enabled=true] true if deletion shoudl be enabled, false otherwise
     */
    // istanbul ignore next
    enableDelete(enabled:boolean=true):void {
        this.deleteable = enabled
    }

    /**
     * returns if workout can be deleted
     * 
     * @returns if workout can be deleted
     */
    canDelete():boolean {
        return this.deleteable
    }

    /**
     * marks the card to be visible/hidden
     * 
     * __note__ In the carousel display, whenever the complete carousel needs to be re-rendered, 
     * all cards will be initially be hidden (so that the renderer can complete faster - especially on large lists)
     * Once the initial rendering is done, the cards will be made visible, 
     * which however will not require a full page/carousel render, but will only update the div containing the card
     * 
     * @param visible  card should be visible(true) or hidden(false)
     * 
     * @emits update event to trigger re-render [[WorkoutCardDisplayProperties]] as argument
     */
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

    protected async _delete():Promise<boolean> {

        // let the caller of delete() consume an intialize the observer first
        await waitNextTick()
        let deleted:boolean = false

        try {

            this.deleteObserver.emit('started')
            await this.getRepo().delete(this.workout) 

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
            })

        }

        

        return deleted

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

    // istanbul ignore next
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
        return false
    }



}