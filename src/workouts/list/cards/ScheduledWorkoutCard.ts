import { ScheduledWorkout } from "../../calendar";
import { ScheduledWorkoutCardDisplayProperties, ScheduledWorkoutSettingsDisplayProps, WorkoutCardType } from "./types";
import { WorkoutCard } from "./WorkoutCard";

export class ScheduledWorkoutCard extends WorkoutCard {

    protected event:ScheduledWorkout

    constructor(event:ScheduledWorkout ) {
        super(event.workout)
        this.event = event
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

    protected isSelected():boolean {
        const service = this.getWorkoutList()
        const selectedWorkout = service.getSelected()


        const isSelected = (selectedWorkout?.id===this.workout.id)

        return isSelected
    }


    getDisplayProperties():ScheduledWorkoutCardDisplayProperties {
        const {day: date} = this.event

        const props = super.getDisplayProperties()

        return {...props,date}
    }




}