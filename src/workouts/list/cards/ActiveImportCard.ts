import { FileInfo } from "../../../api";
import { Card } from "../../../base/cardlist";
import { Observer, PromiseObserver } from "../../../base/types/observer";
import { AppStatus } from "../../../routes/base/types";
import { useWorkoutList } from "../service";
import { WP } from "../types";
import { BaseCard } from "./base";
import { DEFAULT_TITLE, ActiveImportProps, WorkoutCardType } from "./types";


/**
 * [ActiveImportCard](ActiveImportCard.md) objects are used to represent an ongoing import 
 * (to give visible feedback to the user that an import is beeing processed)
 * 
 * The card is also used in case of errors to who the error that has occured
 * 
 * After succesfull imports, the card should be removed from the list
 * 
 * @public
 * @noInheritDoc
 */

export class ActiveImportCard extends BaseCard implements Card<WP> {

    protected file:FileInfo
    protected error:Error
    protected cardObserver 
    protected deleteObserver: PromiseObserver<void>

    constructor( file:FileInfo) {
        super()
        this.file = file;
        this.error = null
        this.cardObserver = new Observer()
    }

    // istanbul ignore next
    setVisible(): void {
        this.visible = true; // always visible
    }

    canDelete(): boolean {
        return true
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    canStart(status: AppStatus) {
        return false;
    }

    /**
     * deletes the card from the Workout List
     * 
     * @returns true if card could be deleted, false otherwise
     */
    delete():PromiseObserver<boolean> {
        const listService = this.getWorkoutList()
        const list = listService.getLists().find( l=>l.getId()==='myWorkouts')
        if (list) {
            list.remove(this)
            listService.emitLists('updated');
        }
        return PromiseObserver.alwaysReturning(true)
        
    }


    /**
     * sets the Error to be shown on the card
     * 
     * @param error the Error object
     */
    setError(error:Error) {
        this.error = error
        this.emitUpdate()
    }

    /**
     * returns the workout that is represented by this card
     * 
     * @returns always will be _undefined_
     */

    getData() {
        return undefined;
    }

    /**
     * returns type of this card
     * 
     * @returns always will be 'ActiveWorkoutImport'
     */

    getCardType(): WorkoutCardType {
        return 'ActiveWorkoutImport';
    }

    /**
     * returns a unique ID of the card
     * 
     * @returns unique ID
     */

    getId(): string {
        const {type,url,filename,name} = this.file||{}

        return type==='file' ? filename||name : url
    }

    /**
     * returns the title of the card 
     * 
     * @returns 'Import Workout'
     */
    getTitle(): string {
        return DEFAULT_TITLE;
    }


    /**
     * returns the information required to render a card in the Workout list
     * 
     * @returns Object containing file name, error (in case there was one) and an observer object
     */
    getDisplayProperties(): ActiveImportProps {
        const name = this.file.name
        const error = this.error
        const observer = this.cardObserver

        return { name,error, observer,visible: true };
    }

    /**
     * will be called by the UI to retry the import
     * 
     * This will clear the error and re-parse the file
     * 
     */
    retry() {

        this.error = null;
        this.emitUpdate()
        
        this.getWorkoutList().import( this.file, this)
    }

    protected emitUpdate() {
        this.cardObserver.emit('update',this.getDisplayProperties())
    }

    protected getWorkoutList() {
        return useWorkoutList()
    }

}
