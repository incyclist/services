import { CardList } from "../../base/cardlist";
import { ListObserver } from "../../base/types";
import { Workout } from "../base/model";
import { ScheduledWorkout } from "../calendar";
import { WorkoutSettings } from "./cards";


export type WP = Workout | ScheduledWorkout;
export interface WorkoutSettingsDisplayProps {
    observer: ListObserver<WP>;
    workouts: CardList<Workout>;
    selected?: Workout;
    settings?: WorkoutSettings;
}
