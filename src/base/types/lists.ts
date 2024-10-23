import { CardList } from "../cardlist";
import { Observer } from "./observer";

export interface IListService<T> {
    close():void;
    getLists(): Array<CardList<T>>

}

export type ListEvent = 'started' | 'stopped' | 'loaded' | 'updated' | 'selected' | 'loading';

export class ListObserver<T> extends Observer {

    constructor(protected service: IListService<T>) {
        super();
    }

    stop() {
        this.service.close();
        this.emit('stopped');
    }

    emit(event: ListEvent, ...payload) {
        this.emitter.emit(event, ...payload);
    }

    getLists(): Array<CardList<T>>{
        return this.service.getLists();
    }


}
