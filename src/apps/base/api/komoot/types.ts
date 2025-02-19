import { LatLng } from "../../../../utils/geo"

export type KomootLoginResponse = {
    authenticated: boolean
    email?: string,
    name?: string,
    id?:string
    status?:string
    error?:string
}

export type KomootAuthConfig = {
    username: string,
    password: string,
    userid: string
}

export type KomootGetTourRequestParams = {
    page?:number,
    limit?: number
    type?: KomootTourType
}
export type KomootGetTourRequestFilters = {
    sport?:string,
    after?:Date,
    lastUpdateAfter?:Date
}

export type KomootTourSummary = {
    id: number,
    type: KomootTourType,
    name: string,
    routing_version: string,
    status: string,
    date: string, // ISO Date
    kcal_active: number,
    kcal_resting: number,
    start_point: KomootPoint,
    distance: number,
    duration: number,
    elevation_up: number,
    elevation_down: number,
    sport: KomootSportType,
    query: string,
    constituation: number,
    summary: {
            surfaces : Array<KomootSummaryType>,
            way_types: Array<KomootSummaryType>
    }
    difficuly: {
        grade: string,
        explanation_technical: string,
        explanation_fitness: string
    }
    tour_information,
    path: Array<{location:LatLng,index:number }>,
    segments: Array<{type:string, from:number, to:number}>,
    changed_at: string, // ISO DATE
    map_image: KomootImageInformation,
    map_image_preview: KomootImageInformation,
    vector_map_image: KomootImageInformation,
    vector_map_image_preview: KomootImageInformation,
    potential_route_update: boolean
}

export type KommotPageInfo = {   
    size: number,
    totalElements: number,
    totalPages: number,
    number: number
}

export type KomootSummaryType = {
    type: string,
    amount: number
}

export type KomootImageInformation = {
    src: string,
    template: boolean,
    type: string,
    attribution: string
}

export interface KomootPoint  {
    lat:number,
    lng:number,
    alt:number
}

export interface KomootCoordinate extends KomootPoint {
    t:number
}

export type KomootTourType = 'tour_planned' | 'tour_recorded'
export type KomootSportType = 'hike'| 'touringbicycle'| 'mtb' |'racebike'  | 'jogging' | 'mtb_easy' | 'mtb_advancde' | 'mountaineering'
export type KomootSportTypeNames = 'Hiking' |'Cycling' | 'Mountain biking' | 'Road cycling' | 'Running' | 'Gravel riding' | 'Enduro mountain biking' | 'Mountaineering'

