import { EventLogger } from "gd-eventlog";
import { JsonRepository } from "../../../api";
import { Observer } from "../../../base/types/observer";
import { Route } from "../../base/model/route";
import { RouteInfo } from "../../base/types";
import { Loader } from "./types";

const DETAILS_PRELOAD_CNT = 20;

export abstract class DBLoader<T> extends Loader<T> {

    protected routeDescriptions: Array<T>;
    protected videosRepo: JsonRepository;
    protected routesRepo: JsonRepository;
    protected logger: EventLogger

    protected abstract loadDescriptions(): Promise<Array<T>>;
    protected abstract buildRouteDBInfo(descr: RouteInfo): T;

    constructor() {
        super()

        this.logger = new EventLogger('RoutesDB')
    }
    

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
        this.verifyImportDate(this.routeDescriptions)

        this.routeDescriptions?.forEach(descr => {

            const route = new Route(this.buildRouteInfo(descr));
           
            this.emitRouteAdded(route);

        });
        this.emitDone()
        
    }

    
    protected abstract verifyImportDate(routes:Array<T>) 



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
