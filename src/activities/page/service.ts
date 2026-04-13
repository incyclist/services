import { EventLogger } from "gd-eventlog";
import { Injectable, Singleton } from "../../base/decorators";
import { IncyclistPageService } from "../../base/pages";
import { ActivitiesPageDisplayProps, IActivitiesPageService } from "./types";
import { IObserver } from "../../types";
import { ActivityListDisplayProperties, useActivityList } from "../list";
import { sleep } from "../../utils/sleep";

@Singleton
export class ActivitiesPageService extends IncyclistPageService implements IActivitiesPageService { 
    protected updateStateHandler    =  this.onStateUpdate.bind(this)

    protected listState: ActivityListDisplayProperties|undefined
    protected detailActivityId: string|undefined

    constructor() {
        super('ActivitiesPage')
    }

    openPage(): IObserver { 
        try {
            this.logEvent({message:'page shown', page:'Routes'})
            EventLogger.setGlobalConfig('page','Routes')

            super.openPage()

            const service = this.getActivityList()
            this.listState = service.openList()
            this.startEventListener()

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
            this.logEvent({message:'page closed', page:'Routes'})        

            this.getActivityList().closeList()
            this.stopEventListener()

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
            this.detailActivityId = id===null ? undefined : id;
            this.updatePageDisplay()
        }
        catch(err) {
            this.logError(err,'onOpenActivity')
        }
    }

    onCloseActivity():void { 
        try {
            delete this.detailActivityId
            this.updatePageDisplay()
        }
        catch(err) {
            this.logError(err,'onCloseActivity')
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

}

export const getActivitiesPageService = () => new ActivitiesPageService()