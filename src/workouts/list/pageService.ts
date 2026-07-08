import { Singleton } from "../../base/types";
import { IncyclistPageService } from "../../base/pages";
import { Injectable } from "../../base/decorators";
import { useAppState } from "../../appstate";
import { IObserver } from "../../types";

export type WorkoutListPageDisplayProps =
    | { pageType: 'placeholder' }
    | { pageType: 'list' }

export interface IWorkoutListPageService {
    getPageDisplayProps(): WorkoutListPageDisplayProps
}

@Singleton
export class WorkoutListPageService extends IncyclistPageService implements IWorkoutListPageService {

    constructor() {
        super('WorkoutListPage')
    }

    openPage(): IObserver {
        try {
            super.openPage()
            this.logEvent({ message: 'page shown', page: 'Workouts' })
            return this.getPageObserver()
        }
        catch (err) {
            this.logError(err, 'openPage')
        }
    }

    closePage(): void {
        try {
            this.logEvent({ message: 'page closed', page: 'Workouts' })
            super.closePage()
        }
        catch (err) {
            this.logError(err, 'closePage')
        }
    }

    getPageDisplayProps(): WorkoutListPageDisplayProps {
        if (!this.getAppState().hasFeature('MOBILE_WORKOUTS')) {
            return { pageType: 'placeholder' }
        }
        return { pageType: 'list' }
    }

    @Injectable
    protected getAppState() {
        return useAppState()
    }
}

export const getWorkoutListPageService = () => new WorkoutListPageService()
