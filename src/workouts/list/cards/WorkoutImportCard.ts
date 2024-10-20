import { Card } from "../../../base/cardlist";
import { ImportFilter } from "../../../base/cardlist/types";
import { PromiseObserver } from "../../../base/types/observer";
import { AppStatus } from "../../../routes/base/types";
import { Workout } from "../../base/model/Workout";
import { BaseCard } from "./base";
import { DEFAULT_FILTERS, DEFAULT_TITLE, WorkoutCardType, WorkoutImportProps } from "./types";

/**
 * [WorkoutImportCard](WorkoutImportCard.md) objects are used to represent the option to trigger an import
 * 
 * The card does __not__ perform the import (this will be done by the [[WorkoutListService]])
 * 
 * @public
 * @noInheritDoc
 */

export class WorkoutImportCard extends BaseCard implements Card<Workout> {

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
        return 'WorkoutImport';
    }

    /**
     * returns a unique ID of the card
     * 
     * @returns ays will be 'Import'
     */

    getId(): string {
        return 'Import';
    }

    /**
     * returns the filters to be shown in the DropBox component 
     * 
     * @returns Filters as currently supported by the service
     */
    getFilters(): Array<ImportFilter> {
        return DEFAULT_FILTERS;
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
     * @returns Object containing title and the filters
     */

    getDisplayProperties(): WorkoutImportProps {
        const title = this.getTitle();
        const filters = this.getFilters();
        return { title, filters, visible: true };
    }



}
