import { UpdateRequest } from "incyclist-devices";
import { ActiveWorkoutLimit, useWorkoutList, useWorkoutRide, WorkoutRide } from "../../workouts";
import { RideModeService } from "../base/base";
import { ActivityUpdate } from "../../activities/ride/types";
import { Injectable } from "../../base/decorators";

const MAX_INACTIVITY = 5000

export class WorkoutDisplayService extends RideModeService {

    protected prevPowerTs: number
    protected buildRequest(props:{limits?: ActiveWorkoutLimit, reset?:boolean}={}): UpdateRequest {
        if (props?.limits) {
            return props.limits
        }
        else return {slope:0}       
    }


    onActivityUpdate(activityPos:ActivityUpdate,data):void { 

        if (data.power>0)
            this.prevPowerTs = Date.now()

        if (data.power===0 && (Date.now()-(this.prevPowerTs??0))>MAX_INACTIVITY) {
            this.service.pause('device')
            return
        }
        super.onActivityUpdate(activityPos,data)
    }

    getLogProps(): object {

        const workout = this.getWorkoutList().getSelected()
        const settings  = this.getWorkoutList().getStartSettings()??{}
        const bikeProps = this.getBikeLogProps()

        return {
            mode:'workout',
            workout: workout.name,
            ...settings,
            ...bikeProps
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