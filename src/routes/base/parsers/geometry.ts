import { FileInfo, getBindings } from "../../../api"
import { Injectable } from "../../../base/decorators"
import { getFileName } from "../../../utils"
import { Parser, ParseResult, RouteBase, RouteInfo, RoutePoint, VideoMapping } from "../types"

export type Geometry = {
    
    geometry: Array<GeometryPoint>
    video_points: Array<VideoPoint>

}

export type GeometryPoint = {
    distance: number,
    longitude: number,
    latitude: number,
    altitude: number
}

export type VideoPoint = {
    distance: number,
    time: number
}

export interface GeoParserData extends RouteBase {
    points: Array<RoutePoint>
    mapping?: Array<VideoMapping>
    
}

export class GeometryParser implements Parser<Geometry,GeoParserData> {

    async import(file: FileInfo, data?: Geometry): Promise<ParseResult<GeoParserData>> {
        const geometry = await this.getData(file,data)
        return await this.parse(file,geometry)        

    }
    supportsExtension(extension: string): boolean {
        return extension.toLowerCase()==='json'
    }
    supportsContent(data: Geometry): boolean {
        return data?.geometry!==undefined
    }
    async getData(file: FileInfo, data?: Geometry): Promise<Geometry> {
        if (data)
            return data

        const onError = ()=> {
            throw new Error('Could not open file: '+ getFileName(file))
        }

        try {
            const res = await this.getLoader().open(file)
            if (res.error) {
                onError()                
            }
            
            return res.data
        }
        catch {
            onError()
        }

    }

    async parse(file: FileInfo,json: Geometry): Promise<ParseResult<GeoParserData>> {


        const geo = json.geometry
        const video = json.video_points

        const points = geo.map( (g,idx)=> {
            return {                
                cnt: idx,
                lat:g.latitude,
                lng:g.longitude,
                elevation:g.altitude,
                routeDistance: g.distance,
                distance: idx===0 ? 0 : g.distance-geo[idx-1].distance
            }
        })

        const len = video.length
        let videoSpeed = 0

        const mapping = video.map( (m,idx)=> {
            if (idx<len-1)
                videoSpeed =  (video[idx+1].distance-m.distance)/(video[idx+1].time-m.time)*3.6;

            return {...m,videoSpeed}
        })

        const data:Partial<RouteInfo> = {
            distance: json.geometry[json.geometry.length-1].distance,
            points,
            requiresDownload: false,
            hasGpx: true,
        }

        const details:GeoParserData = {
            id: 'geo',
            title: getFileName(file),
            points,
            mapping
            
        }

        return {data,details}
        
        
        
    }

    @Injectable
    protected getLoader() {
        return getBindings().loader
    }

}