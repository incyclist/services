import { EventLogger } from "gd-eventlog";
import { Injectable, Singleton } from "../../base/decorators";
import { IncyclistPageService } from "../../base/pages";
import { ActivitiesPageDisplayProps, ActivityDetailsProps, AttachedWorkoutProps, IActivitiesPageService } from "./types";
import { IObserver } from "../../types";
import { ActivityListDisplayProperties, useActivityList } from "../list";
import { sleep } from "../../utils/sleep";
import { useWorkoutList } from "../../workouts";

@Singleton
export class ActivitiesPageService extends IncyclistPageService implements IActivitiesPageService { 
    protected updateStateHandler    =  this.onStateUpdate.bind(this)

    protected listState: ActivityListDisplayProperties|undefined
    protected detailActivityId: string|undefined
    protected isOpen: boolean = false

    constructor() {
        super('ActivitiesPage')
    }

    openPage(): IObserver { 

        if (this.isOpen) {
            this.getActivityList().closeList()
            this.stopEventListener()

        }
            

        try {
            this.logEvent({message:'page shown', page:'Activities'})
            EventLogger.setGlobalConfig('page','Activities')

            super.openPage()

            const service = this.getActivityList()
            this.listState = service.openList()
            this.startEventListener()
            this.isOpen = true

            // give the client time to consume the observer, then emit initial state
            sleep(5).then( ()=>{
                this.updatePageDisplay()
            })
          

            return this.getPageObserver()
        }   
        catch(err) {
            this.logError(err,'openPage')

        }
    }

    closePage(): void {
        try {
            EventLogger.setGlobalConfig('page',null)
            this.logEvent({message:'page closed', page:'Activities'})        

            this.getActivityList().closeList()
            this.stopEventListener()

            this.isOpen = false
            super.closePage()
        }
        catch(err) {
            this.logError(err,'closePage')
        }
    }
    pausePage(): Promise<void> {
        try {
            this.stopEventListener()
            return super.pausePage()
        }
        catch(err) {
            this.logError(err,'pausePage')
        }
    }

    resumePage(): Promise<void>  {
        try {
            this.startEventListener()
            return super.resumePage()
        }
        catch(err) {
            this.logError(err,'resumePage')
        }
    }

    getPageDisplayProps():ActivitiesPageDisplayProps { 

        const props:ActivitiesPageDisplayProps =  {
            loading: this.listState.loading,
            activities: this.listState.activities,
            detailActivityId: this.detailActivityId
        }

        return props
    }

    onOpenActivity(id:string|null):void {
        try {
            this.getActivityList().select(id)
            this.detailActivityId = id===null ? undefined : id;
            this.updatePageDisplay()
        }
        catch(err) {
            this.logError(err,'onOpenActivity')
        }
    }

    onCloseActivity():void { 
        try {
            this.detailActivityId = null
            this.updatePageDisplay()
        }
        catch(err) {
            this.logError(err,'onCloseActivity')
        }

    }


    /**
     * The workout currently paired with `activityId`, for the "Workout: <name>" row on the
     * activity details dialog (HLD §4.2). `ActivityListService.openSelected()` /
     * `getSelectedActivityDisplayProps()` are not touched - see
     * mobile/internal/designs/workout-combo-service-design.md §3.6. Takes `activityId` (rather than
     * reading `ActivityListService.getSelected()`) so it stays a pure read for the activity the
     * dialog is actually showing - symmetric with `RoutesPageService.getRouteDetailsProps(routeId)`.
     */
    getActivityDetailsProps(activityId: string): ActivityDetailsProps {
        try {
            const workout = this.getWorkoutList().getSelected()
            const attachedWorkout: AttachedWorkoutProps | null = workout ? { id: workout.id, title: workout.name } : null

            return { activityId, attachedWorkout }
        }
        catch (err) {
            this.logError(err, 'getActivityDetailsProps')
            return { activityId, attachedWorkout: null }
        }
    }

    /** '[x]' on the "Workout: <name>" row (HLD §4.2). */
    onClearWorkoutSelection(): void {
        try {
            this.getWorkoutList().unselect()
            this.updatePageDisplay()
        }
        catch (err) {
            this.logError(err, 'onClearWorkoutSelection')
        }
    }

    /**
     * Deletes an activity from the list, for the swipe-to-delete action on the Activities list.
     * `ActivityListService.delete()` emits its own 'updated' event on success, which
     * `startEventListener()` already forwards into a page update - no extra refresh needed here.
     */
    async onDeleteActivity(id: string): Promise<boolean> {
        try {
            return await this.getActivityList().delete(id)
        }
        catch (err) {
            this.logError(err, 'onDeleteActivity')
            return false
        }
    }

    protected updatePageDisplay() {
        this.getPageObserver()?.emit('page-update')
    }


    protected onStateUpdate() {
        this.updatePageDisplay()
    }


    protected startEventListener() {
        const observer  = this.getActivityList().getObserver()
        if (!observer)
            return

        observer.on('updated', this.updateStateHandler)
        observer.on('loaded', this.updateStateHandler)

       
    }

    protected stopEventListener(final?:boolean) {
        const observer  = this.getActivityList().getObserver()
        if (!observer)
            return

        observer.off('updated', this.updateStateHandler)
        observer.off('loaded', this.updateStateHandler)

    }



    @Injectable
    getActivityList()  {
        return useActivityList()
    }

    @Injectable
    protected getWorkoutList() {
        return useWorkoutList()
    }

}

export const getActivitiesPageService = () => new ActivitiesPageService()