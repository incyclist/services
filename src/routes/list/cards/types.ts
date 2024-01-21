import { ImportFilter } from "../../../base/cardlist/types";
import { Observer } from "../../../base/types/observer";


export type RouteCardType = 'Import' | 'Route' | 'Free-Ride' | 'ActiveImport';


export const DEFAULT_TITLE = 'Import Route';
export const DEFAULT_FILTERS = [
    { name: 'Routes', extensions: ['gpx', 'epm', 'xml'] },
    { name: 'Tracks', extensions: ['gpx'] },
    { name: 'RLV: ErgoPlanet', extensions: ['epm'] },
    { name: 'RLV: Incyclist, KWT, Rouvy,Virtualtrainer ', extensions: ['xml'] },
];

export interface RouteImportProps {
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

