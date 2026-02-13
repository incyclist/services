import { IncyclistService } from "../service";
import { Observer } from "../types";

import type { IPageService } from "./types";
import { Injectable } from "../decorators";
import { useAppState } from "../../appstate";
import { IObserver } from "../typedefs";

export class IncyclistPageService extends IncyclistService implements IPageService {

    private pageObserver: Observer|undefined

    static currentPage: IPageService|undefined

    static async pausePage() {
        await this.currentPage?.pausePage()
    }
    
    static async resumePage() {
        await this.currentPage?.resumePage()
    }

    constructor( protected name:string) {
        super(name)
    }

    openPage(): IObserver {
        this.stopObserver()
        this.pageObserver = new Observer()

        this.getAppState().setState('currentPage',this.name )
        IncyclistPageService.currentPage = this
        return this.pageObserver
        
    }
    closePage(): void {
        delete IncyclistPageService.currentPage
        this.getAppState().setState('prevPage',this.name )
        this.getAppState().setState('currentPage',null )
        this.getAppState().setState('currentPageService',null )
        this.stopObserver()
    }
    
    async pausePage(): Promise<void> {
        // to be implemented by sub-class
    }
    async resumePage(): Promise<void> {
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