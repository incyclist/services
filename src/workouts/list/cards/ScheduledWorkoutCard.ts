import { Workout } from "../../base/model";
import { ScheduledWorkout } from "../../calendar";
import { ScheduledWorkoutCardDisplayProperties, ScheduledWorkoutSettingsDisplayProps, WorkoutCardType } from "./types";
import { WorkoutCard } from "./WorkoutCard";

export class ScheduledWorkoutCard extends WorkoutCard {

    protected event:ScheduledWorkout

    constructor(event:ScheduledWorkout ) {
        super( new Workout(event.workout))
        this.event = event
        this.event.observer?.on('updated', this.onUpdate.bind(this))

    }
    /**
     * returns type of this card
     * 
     * @returns always will be 'Workout'
     */
    getCardType():WorkoutCardType {
        return "ScheduledWorkout"
    }

    openSettings():ScheduledWorkoutSettingsDisplayProps {
        const settings =  super.openSettings()
        const {day: date} = this.event
        return {...settings,date, category: 'scheduled'}

    }

    getDisplayProperties():ScheduledWorkoutCardDisplayProperties {
        const {day: date} = this.event

        const props = super.getDisplayProperties()

        return {...props,date}
    }


    protected isSelected():boolean {
        const service = this.getWorkoutList()
        const selectedWorkout = service.getSelected()


        const isSelected = (selectedWorkout?.id===this.workout.id)

        return isSelected
    }

    protected onUpdate(scheduled:ScheduledWorkout) {

        const wasSelected = this.isSelected()
        this.event = scheduled
        this.workout = scheduled.workout

        this.checkSelectionChanges(wasSelected)

        this.emitUpdate()
   }

   protected checkSelectionChanges(wasSelected:boolean) {
       // TODO: if the card was selected, but the date is not the current date anymore, we need to unselect
       // TODO: if the card was not selected, but the date is the current date, we need to select
   }


}