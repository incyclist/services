import { StravaRouteSubType, StravaRouteType } from "./types"

export const StravaRouteSubTypeToString: Record<StravaRouteSubType,string> = {
    1: 'racebike',
    2: 'mtb',
    3: 'cross',
    4: 'trail',
    5: 'mixed'
}
export const StringToStravaRouteSubType: Record<string,StravaRouteSubType> = {
    racebike:1,
    mtb:2,
    cross:3,
    trail:4,
    mixed:5
}

export const StravaRouteTypeToString: Record<StravaRouteType,string> = {
    1: 'ride',
    2: 'run',
    3: 'walk',
    4: 'hike',
    5: 'trailrun',
    6: 'gravel',
    7: 'mtb'
}
export const StringToStravaRouteType: Record<string,StravaRouteType> = {
    ride:1,
    run:2,
    walk:3,
    hike:4,
    trailrun:5,
    gravel:6,
    mtb:7
}

