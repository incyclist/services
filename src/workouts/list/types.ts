import { CardList } from "../../base/cardlist";
import { ListObserver } from "../../base/types";
import { Workout, Plan } from "../base/model";
import { WorkoutSettings } from "./cards";


export type WP = Workout | Plan;
export interface WorkoutSettingsDisplayProps {
    observer: ListObserver<WP>;
    workouts: CardList<Workout>;
    selected?: Workout;
    settings?: WorkoutSettings;
}
