import { CardList } from "../../base/cardlist";
import { Observer } from "../../base/types/observer";
import { Route } from "../base/model/route";
import { RouteListService } from "./service";

type RouteListEvent = 'started' | 'stopped' | 'loaded' | 'updated' | 'selected' | 'sync-start' | 'sync-done';
export class RouteListObserver extends Observer {

    constructor(protected service: RouteListService) {
        super();
    }
    stop() {
        this.service.close();
        this.emit('stopped');
    }

    emit(event: RouteListEvent, ...payload) {
        this.emitter.emit(event, ...payload);
    }

    getLists(): Array<CardList<Route>> {
        return this.service.getLists();
    }


}
