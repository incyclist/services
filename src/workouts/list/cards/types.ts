import { ImportFilter } from "../../../base/cardlist/types";
import { Observer } from "../../../base/types/observer";
import { Workout } from "../../base/model";

export type WorkoutCardType = 'WorkoutImport' | 'Workout' | 'ActiveWorkoutImport' ;

export const DEFAULT_TITLE = 'Import Workout';
export const DEFAULT_FILTERS = [
    { name: 'Workouts', extensions: ['zwo'] },
    { name: 'Zwift', extensions: ['zwo'] }
];

export interface WorkoutImportProps {
    title: string;
    filters: Array<ImportFilter>;
    visible: boolean;
}

export interface ActiveImportProps {
    name: string;
    error?: Error
    visible: boolean;
    observer: Observer
}

export interface WorkoutSettings {
    /** FTP to be used for the workout (default to FTP from user settings) */
    ftp?: number;
    /** identifies if ERG Mode should be used during the workout (default:true) */
    useErgMode?: boolean;
}

export interface WorkoutSettingsDisplayProps {
    /** the current settings for the workout */
    settings: WorkoutSettings,
    /** identifies if the workout requires an FTP ( not required e.g. if all limits are in Watts) */
    ftpRequired: boolean;
    /** identifies if the start button should be rendered (i.e. if there is a route selected) */
    canStart: boolean
    /** The duration of the workout */
    duration: string
    /** The list of available categories */
    categories: string[]
    /** The category, this workout belongs to */
    category: string
}

export interface WorkoutCardDisplayProperties {
    /** title to be shown on card */
    title: string
    /** the whole workout objct (so that graph can be rendered) */
    workout: Workout
    /** FTP settings to be used during rendering  */
    ftp: number
    /** The duration of the workout */
    duration: string
    /** identifies if a delete button can be shown */
    canDelete: boolean
    /** identifies if the card is visible(true) or hidden(false) */
    visible: boolean
    /** identifies if the workout was selected for the next ride*/
    selected: boolean
    /** observer Object that will be used to informa abotu relevant updates*/
    observer: Observer

}