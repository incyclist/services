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

    /**
     * Whether the route+workout combination surface (Phase 2) is live.
     *
     * MOBILE_WORKOUT_ROUTE_COMBO implies MOBILE_WORKOUTS and is never honoured without it: the whole
     * combo flow forward-navigates into the Workouts page, which renders an "under development"
     * placeholder when MOBILE_WORKOUTS is off (WorkoutListPageService.getPageDisplayProps()). Honouring
     * COMBO alone would put an "Add Workout" button on the route dialog whose destination is a
     * placeholder - a dead end reachable purely from a hand-edited settings.json.
     *
     * Lives on the page-service base rather than being repeated in four subclasses so the two toggles
     * can never be combined differently in different places. Safe by construction w.r.t. desktop/web:
     * every IncyclistPageService subclass is mobile-only (HLD §9.4), and web-ui has zero references to
     * any of them.
     */
    protected isWorkoutComboEnabled(): boolean {
        try {
            const appState = this.getAppState()
            return appState.hasFeature('MOBILE_WORKOUTS')
                && appState.hasFeature('MOBILE_WORKOUT_ROUTE_COMBO')
        }
        catch (err) {
            this.logError(err, 'isWorkoutComboEnabled')
            return false
        }
    }

}