import { UpdateRequest } from "incyclist-devices";
import { ActiveWorkoutLimit, useWorkoutList, useWorkoutRide, WorkoutRide } from "../../workouts";
import { RideModeService } from "../base/base";
import { ActivityUpdate } from "../../activities/ride/types";
import { Injectable } from "../../base/decorators";

const MAX_INACTIVITY = 5000

export class WorkoutDisplayService extends RideModeService {

    protected prevPowerTs: number
    protected buildRequest(limits: ActiveWorkoutLimit): UpdateRequest {
        if (limits) {
            return limits
        }
        else return {slope:0}       
    }


    onActivityUpdate(activityPos:ActivityUpdate,data):UpdateRequest|undefined { 

        if (data.power>0)
            this.prevPowerTs = Date.now()

        if (data.power===0 && (Date.now()-(this.prevPowerTs??0))>MAX_INACTIVITY) {
            this.service.pause('device')
            return
        }
        return super.onActivityUpdate(activityPos,data)
    }

    getLogProps(): object {

        const workout = this.getWorkoutList().getSelected()
        const settings  = this.getWorkoutList().getStartSettings()??{}

        return {
            mode:'workout',
            workout: workout.name,
            ...settings
        }
    }

    @Injectable
    protected getWorkoutRide(): WorkoutRide {
        return useWorkoutRide()
        
    }

    @Injectable
    protected getWorkoutList() {
        return useWorkoutList()
    }


    
}