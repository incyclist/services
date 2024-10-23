import { Card } from "../../../base/cardlist";
import { ImportFilter } from "../../../base/cardlist/types";
import { PromiseObserver } from "../../../base/types/observer";
import { Route } from "../../base/model/route";
import { BaseCard } from "./base";
import { RouteCardType, DEFAULT_FILTERS, DEFAULT_TITLE, RouteImportProps } from "./types";
import { AppStatus } from "../../base/types";


export class RouteImportCard extends BaseCard implements Card<Route> {

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
    getCardType(): RouteCardType {
        return 'Import';
    }
    getId(): RouteCardType {
        return 'Import';
    }

    getFilters(): Array<ImportFilter> {
        return DEFAULT_FILTERS;
    }

    getTitle(): string {
        return DEFAULT_TITLE;
    }

    getDisplayProperties(): RouteImportProps {
        const title = this.getTitle();
        const filters = this.getFilters();
        return { title, filters, visible: true };
    }

}
