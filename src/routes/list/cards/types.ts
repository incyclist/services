import { ImportFilter } from "../../../base/cardlist/types";


export type RouteCardType = 'Import' | 'Route' | 'Free-Ride';


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

export interface AppStatus {
    isOnline?: boolean;
}
