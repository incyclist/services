import { CyclingMode, UpdateRequest } from "incyclist-devices";
import { getLoadButtonMode } from "../../devices";
import { ActiveWorkoutLimit, useWorkoutList, useWorkoutRide, WorkoutRide } from "../../workouts";
import { RideModeService } from "../base/base";
import { ActivityUpdate } from "../../activities/ride/types";
import { Injectable } from "../../base/decorators";

const MAX_INACTIVITY = 5000

export class WorkoutDisplayService extends RideModeService {

    protected prevPowerTs: number

    // FIXES_BACKLOG #37 investigation: this is the actual live mechanism that pushes a workout
    // step's target to the device (fired every activity/device-data tick via
    // RideModeService.onActivityUpdate() -> buildRequest({limits}) -> sendUpdate()) - the
    // 'request-update' event WorkoutRide.setCurrentLimits() emits is dead code, its only listener
    // is commented out in RideDisplayService.initWorkout() and nothing else subscribes to it.
    //
    // This push previously ran unconditionally, in ERG *and* SIM/Resistance mode alike. Per the
    // product decision for #37, once the rider is in SIM/Resistance mode during a workout, the
    // step's target is purely informational - the rider manages load themselves via cadence and/or
    // gear - so it must stop being pushed to the device there, or it would keep re-asserting
    // min/maxPower/targetPower on top of (and fighting/masking the effect of) the rider's manual
    // gear shifts. Only push while `getLoadButtonMode()==='power'` (ERG mode, or no device/mode
    // active yet); gear shifts themselves go through WorkoutRide.gearChange() instead, independent
    // of this path.
    protected buildRequest(props:{limits?: ActiveWorkoutLimit, reset?:boolean}={}): UpdateRequest {
        if (props?.limits) {
            const mode = this.getDeviceRide().getCyclingMode() as CyclingMode
            if (getLoadButtonMode(mode)!=='power')
                return {}

            return props.limits
        }
        else return {slope:0}
    }


    onActivityUpdate(activityPos:ActivityUpdate,data):void { 
        try {

            if (data.power>0)
                this.prevPowerTs = Date.now()

            if (data.power===0 && (Date.now()-(this.prevPowerTs??0))>MAX_INACTIVITY) {
                this.service.pause('device')
                return
            }
            super.onActivityUpdate(activityPos,data)
        }
        catch(err) {
            this.logError(err,'onActivityUpdate')
        }
    }

    getLogProps(): object {

        const workout = this.getWorkoutList().getSelected()??this.getWorkoutRide().getWorkout()
        const settings  = this.getWorkoutList().getStartSettings()??{}
        const bikeProps = this.getBikeLogProps()

        return {
            mode:'workout',
            workout: workout?.name,
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