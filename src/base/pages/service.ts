import { IncyclistService } from "../service";
import { Observer } from "../types";

import type { IPageService } from "./types";
import { Injectable } from "../decorators";
import { useAppState } from "../../appstate";
import { IObserver } from "../typedefs";
import { getBindings } from "../../api";

export class IncyclistPageService extends IncyclistService implements IPageService {

    private pageObserver: Observer|undefined

    static currentPage: IPageService|undefined

    static closePage() {
        this.currentPage?.closePage()
    }

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

    protected getPrevContentPage():string {
        const contentPage = this.getAppState().getPersistedState('page')
        return contentPage ?? 'routes'
    }

    protected moveTo( route:string, close:boolean=true) {

        if (route==='$contentPage') {
            const prevContentPage = this.getPrevContentPage()
            this.getUIBinding().openPage(prevContentPage)
        }
        else {
            this.getUIBinding().openPage(route)
        }

        if (close) {
            this.closePage()
        }
    }

    protected getUIBinding() {
        return this.getBindings().ui
    }

    @Injectable 
    protected getBindings() {
        return getBindings()

    }


    @Injectable
    protected getAppState() {
        return useAppState()
    }


    
}