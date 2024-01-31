import { ImportFilter } from "../../../base/cardlist/types";
import { Observer } from "../../../base/types/observer";

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
    ftp?: number;
    useErgMode?: boolean;
}