import { JsonRepository } from "../../../api";
import { Observer } from "../../../base/types/observer";
import { Route } from "../../base/model/route";
import { RouteInfo } from "../../base/types";
import { Loader } from "./types";


export abstract class DBLoader<T> extends Loader<T> {

    protected routeDescriptions: Array<T>;
    protected videosRepo: JsonRepository;
    protected routesRepo: JsonRepository;

    protected abstract loadDescriptions(): Promise<Array<T>>;
    protected abstract buildRouteDBInfo(descr: RouteInfo): T;

    load(): Observer {
        if (this.loadObserver)
            return this.loadObserver;

        this.loadObserver = new Observer();
        this._load();
        return this.loadObserver;

    }

    stopLoad() {
        delete this.loadObserver;
    }

    protected async _load() {
        this.routeDescriptions = await this.loadDescriptions();
        const promises:Array<Promise<void>> = []
        this.routeDescriptions?.forEach(descr => {

            const route = new Route(this.buildRouteInfo(descr));
            const isComplete = this.isCompleted(route);
            
            
            if (isComplete) {
                this.emitRouteAdded(route);
            }
            else { 
                promises.push(this.loadDetails(route,isComplete))
            }
        });
        await Promise.allSettled(promises)
        this.emitDone()
        
    }


    protected getVideosRepo(): JsonRepository {
        if (this.videosRepo)
            return this.videosRepo;
        this.videosRepo = JsonRepository.create('videos');
        return this.videosRepo;
    }
    protected getRoutesRepo(): JsonRepository {
        if (this.routesRepo)
            return this.routesRepo;
        this.routesRepo = JsonRepository.create('routes');
        return this.routesRepo;
    }

    protected abstract loadDetails(route:Route,allreadyAdded?:boolean):Promise<void>


}
