import { Card } from "../../../base/cardlist";
import { ImportFilter } from "../../../base/cardlist/types";
import { Injectable } from "../../../base/decorators";
import { PromiseObserver } from "../../../base/types/observer";
import { AppStatus } from "../../../routes/base/types";
import { useUserSettings } from "../../../settings";
import { Workout } from "../../base/model/Workout";
import { BaseCard } from "./base";
import { DEFAULT_FILTERS,  WorkoutCardType, WorkoutCreateProps, WorkoutImportProps } from "./types";

const DEFAULT_TITLE = "Create Workout";
const DEFAULT_LINK =  'https://zwofactory.com/' 
/**
 * [WorkoutImportCard](WorkoutImportCard.md) objects are used to represent the option to trigger an import
 * 
 * The card does __not__ perform the import (this will be done by the [[WorkoutListService]])
 * 
 * @public
 * @noInheritDoc
 */

export class WorkoutCreateCard extends BaseCard implements Card<Workout> {

    // istanbul ignore next
    setVisible(): void {
        this.visible = true; // always visible
    }

    canDelete():boolean {
        return false;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    canStart(status: AppStatus) {
        return false;
    }

    /**
     * deletes the card from the Workout List - this should never be called
     * 
     * @returns always returnfs false, as card cannot be deleted
     */

    // istanbul ignore next
    delete():PromiseObserver<boolean> {
        // not possible to delete FreeRide Card
        return PromiseObserver.alwaysReturning(false)
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
     * @returns always will be 'WorkoutImport'
     */
    getCardType(): WorkoutCardType {
        return 'WorkoutCreate';
    }

    /**
     * returns a unique ID of the card
     * 
     * @returns ays will be 'Import'
     */

    getId(): string {
        return 'Create';
    }

    /**
     * returns the filters to be shown in the DropBox component 
     * 
     * @returns Filters as currently supported by the service
     */
    getFilters(): Array<ImportFilter> {
        return [];
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
     * Returns the properties required to display the workout creation card.
     * 
     * @returns {WorkoutCreateProps} An object containing:
     * - `title`: The title of the card.
     * - `visible`: A boolean indicating if the card should be visible.
     * - `link`: The link to an external page (ZwoFactory) associated with the card.
     * - `firstTime`: A boolean indicating if it is the user's first time opening the card.
     */

    getDisplayProperties(): WorkoutCreateProps {
        const title = this.getTitle();
        const firstTime = this.getUserSettings().get('state.createWorkoutSeen',false)===false
        return { title, visible: true, link:DEFAULT_LINK, firstTime };
    }

    /**
     * sets the flag to remember that the user has seen the "Create Workout" explanation overlay
     * 
     * @see getUserSettings
     */
    markAsSeen():void {
        this.getUserSettings().set('state.createWorkoutSeen',true)
    }

    @Injectable
    getUserSettings() {
        return useUserSettings()
    }


}
