import { Card } from "../../../base/cardlist";
import { ImportFilter } from "../../../base/cardlist/types";
import { PromiseObserver } from "../../../base/types/observer";
import { AppStatus } from "../../../routes/base/types";
import { Workout } from "../../base/model/Workout";
import { BaseCard } from "./base";
import { DEFAULT_FILTERS, DEFAULT_TITLE, WorkoutCardType, WorkoutImportProps } from "./types";


export class WorkoutImportCard extends BaseCard implements Card<Workout> {

    setVisible(): void {
        this.visible = true; // always visible
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    canStart(status: AppStatus) {
        return false;
    }
    delete():PromiseObserver<boolean> {
        // not possible to delete FreeRide Card
        return PromiseObserver.alwaysReturning(false)
    }

    setData() {
        //ignore
    }
    getData() {
        return undefined;
    }
    getCardType(): WorkoutCardType {
        return 'WorkoutImport';
    }
    getId(): string {
        return 'Import';
    }

    getFilters(): Array<ImportFilter> {
        return DEFAULT_FILTERS;
    }

    getTitle(): string {
        return DEFAULT_TITLE;
    }

    getDisplayProperties(): WorkoutImportProps {
        const title = this.getTitle();
        const filters = this.getFilters();
        return { title, filters, visible: true };
    }



}
