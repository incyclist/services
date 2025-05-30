import { FreeRideOption } from "../../routes/list/types"
import { LatLng } from "../../utils/geo"

export interface GetNextOptionProps  {
    minDistance?:number
}

export interface IMapArea {
    getQueryLocation():IncyclistNode 
    getWays():IncyclistWay[]
    getWay(id:string):IncyclistWay
    getNode(id:string):IncyclistNode
    getStats():Record<string,number>
    getBoundary():Boundary 

    isWithinBoundary(location:LatLng):boolean 
    getNearestPath(point:IncyclistNode):NearestPathInfo 
    splitAtFirstBranch(way:WayInfo):IncyclistWaySplit
    splitAtCrossingPoint(way:WayInfo,split:PathCrossingInfo):Array<IncyclistWaySplit>
    buildSegmentInfo(from:IncyclistWay, parts:Array<IncyclistWaySplit>):SegmentInfo
    getHeading(way:WayInfo, position?:'start'|'end'):number
}

export type MapAreaOpenProps = {
    minWays?:number,
    maxWays?:number,
    radius?:number,
    filter?: Array<string>
    location?:IncyclistNode
}

export type FreeRidePosition = {
    location?: IncyclistNode,
    options?: Array<FreeRideContinuation>
}

export type FreeRideContinuation = {
    id?: string,
    path: Array<IncyclistNode>
    onewayReverse?:boolean
    direction?:number
    options?: Array<FreeRideContinuation>
    map?: IMapArea
    ui?:FreeRideOption
}

export interface IMapAreaService  {
    load( location: IncyclistNode): Promise<IMapArea>
    getMap(location:IncyclistNode):IMapArea 
}


export type Boundary = {
    southwest: LatLng
    northeast: LatLng
}

export interface CrossingInfo extends LatLng {
    distance:number
}

export interface NearestPathInfo {
    path:IncyclistNode[], 
    distance:number, 
    way:IncyclistWay
}
export interface PathCrossingInfo {
    point:IncyclistNode, 
    distance:number, 
    idx:number
}

export type OverpassElementType = 'way' | 'node'

export type OverpassTags = {}

export type OverpassBounds = {
    minlat:number, 
    minlon: number,
    maxlat: number,
    maxlon: number
}

export type OverpassElement = {
    type: OverpassElementType
    id: number,
    tags?: Record<string,string>
    lat?:number,
    lon?:number

}

export interface OverpassNode extends OverpassElement {
    type:'node'
}
export interface OverpassWay extends OverpassElement {
    type: 'way'
    bounds: OverpassBounds              
    nodes?: Array<number>
    geometry?: Array<{lat:number, lon:number}>

}

export type OverpassResult = {
    version: number
    generator?: string
    elements?: Array<OverpassElement>
    
}

export interface IncyclistNode extends LatLng {
    id?: string,
    ways?: Array<string>
    tags?: Record<string,string>    
}


export type WayInfo = {
    id: string,
    path: Array<IncyclistNode>
    onewayReverse?:boolean
}

export interface IncyclistWay  extends WayInfo {
    type:string, 
    name:string, 
    tags: Record<string,any>, 
    bounds:OverpassBounds
    map?:IMapArea

    roundabout?:boolean
    originalId?:string

}


export type FreeRideDataSet = {
    nodesLookup: Record<string, IncyclistNode>
    ways: Array<IncyclistWay>
    waysLookup: Record<string, IncyclistWay>
    typeStats: Record<string,number>
}



export type IncyclistWaySplit = {
    wayId: string
    branches?: Array<WayInfo>
    path?: Array<IncyclistNode>

}

export type SplitPointInfo = {
    point:IncyclistNode,
    idx:number,
    branches: Array<string>
}

export type SegmentInfo = {
    segments: Array<WayInfo>
    points: Array<IncyclistNode>
}
