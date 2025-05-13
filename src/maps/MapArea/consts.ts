
export const RADIUS_EARTH = 6378.1;
export const DEFAULT_RADIUS = 1000; // 1000m default radius
export const DEFAULT_MIN_WAYS = 70;
export const DEFAULT_MAX_WAYS = 300;
export const MAX_DISTANCE_FROM_PATH = 5; // 5m is considered to be max distance a point can be off a path to be counted "inside"
export const GET_WAYS_IN_AREA = '[out:json];way[highway](__boundary__);(._;>;);out geom;';
export const DEFAULT_FILTER = [ 'construction','footway','service','pedestrian', 'path', 'cycleway','elevator','steps','track','escape','bus_guideway','busway','bridleway','corridor','via_ferrata'];
export const DEFAULT_POSITION ={ lat:26.68537966608196,lng:-80.03481961660725 } //Palm  Beach

