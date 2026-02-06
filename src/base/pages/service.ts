import { IncyclistService } from "../service";
import { Observer } from "../types";

import type { IPageService } from "./types";
import type { IObserver} from "../types";

export class IncyclistPageService extends IncyclistService implements IPageService {

    private pageObserver: Observer|undefined

    constructor( name:string) {
        super(name)
    }

    openPage(): IObserver {
        this.stopObserver()
        this.pageObserver = new Observer()
        return this.pageObserver
        
    }
    closePage(): void {
        this.stopObserver()
    }
    
    pausePage(): void {
        // to be implemented by sub-class
    }
    resumePage(): void {
        // to be implemented by sub-class
    }
    getPageObserver(): IObserver {
        return this.pageObserver
       
    }

    protected stopObserver() {
        if (this.pageObserver) {
            this.pageObserver.stop()
            delete this.pageObserver
        }

    }


    
}