import { IncyclistService } from "../service";
import { Observer } from "../types";

import type { IPageService } from "./types";
import { Injectable } from "../decorators";
import { useAppState } from "../../appstate";
import { IObserver } from "../typedefs";

export class IncyclistPageService extends IncyclistService implements IPageService {

    private pageObserver: Observer|undefined
    

    constructor( protected name:string) {
        super(name)
    }

    openPage(): IObserver {
        this.stopObserver()
        this.pageObserver = new Observer()

        this.getAppState().setState('currentPage',this.name )
        return this.pageObserver
        
    }
    closePage(): void {
        this.getAppState().setState('prevPage',this.name )
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

    @Injectable
    protected getAppState() {
        return useAppState()
    }


    
}