import { FileInfo, getBindings } from "../../../api"
import { Injectable } from "../../../base/decorators"
import { getFileName } from "../../../utils"
import { RouteBase, RouteInfo, RoutePoint, VideoMapping } from "../types"

import type { Parser, ParseResult } from "./types"
import { getUtf8Data } from "./utils"

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

/**
 * Parser for geometry data in JSON format containing route points and video mappings.
 * Converts geometry points and video timing information into a standardized route format.
 */
export class GeometryParser implements Parser<Geometry,GeoParserData> {

    /**
     * Imports geometry data from a file or provided data object and parses it into a route.
     * @param file The file information for the geometry data
     * @param data Optional pre-loaded geometry data; if provided, file is not read
     * @returns Promise resolving to parsed route data and metadata
     */
    async import(file: FileInfo, data?: Geometry): Promise<ParseResult<GeoParserData>> {
        const geometry = await this.getData(file,data)
        return await this.parse(file,geometry)

    }

    /**
     * Returns the primary file extension supported by this parser.
     * @returns The primary extension ('json')
     */
    getPrimaryExtension(): string {
        return 'json'
    }

    /**
     * Returns companion extensions that can be imported alongside the primary format.
     * @returns Array of companion extensions (empty for this parser)
     */
    getCompanionExtensions(): string[]    {
        return []
    }

    /**
     * Checks if the given file extension is supported by this parser.
     * @param extension The file extension to check
     * @returns True if the extension is 'json' (case-insensitive), false otherwise
     */
    supportsExtension(extension: string): boolean {
        return extension.toLowerCase()==='json'
    }

    /**
     * Checks if the provided data object contains valid geometry content.
     * @param data The geometry data to validate
     * @returns True if the data contains a geometry property, false otherwise
     */
    supportsContent(data: Geometry): boolean {
        return data?.geometry!==undefined
    }

    /**
     * Retrieves geometry data either from the provided object or by loading from file.
     * @param file The file information to load from if data is not provided
     * @param data Optional pre-loaded geometry data; returned directly if provided
     * @returns Promise resolving to the geometry data
     * @throws Error if the file cannot be opened or parsed
     */
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
            const cleaned = getUtf8Data(res.data)

            return JSON.parse(cleaned) as unknown as Geometry
        }
        catch {
            onError()
        }

    }

    /**
     * Parses geometry data into route points and video mapping information.
     * Sorts and deduplicates geometry and video points by their respective distance/time values,
     * then maps them to a standardized route format with video speed calculations.
     * @param file The file information used to generate the route title
     * @param json The geometry data to parse
     * @returns Promise resolving to parsed route data and metadata
     */
    async parse(file: FileInfo,json: Geometry): Promise<ParseResult<GeoParserData>> {


        let geo = (json.geometry??[]).sort( (a,b) => a.distance-b.distance)
        let video = (json.video_points??[]).sort( (a,b) => a.time-b.time)

        geo = geo.filter((v,idx) => idx===0 || v.distance!==geo[idx-1].distance)
        video = video.filter((v,idx) => idx===0 || v.time!==video[idx-1].time)

        if (!video.length) {
            console.log('# no video information')
        }

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

        const mapping = len===0 ? undefined : video.map( (m,idx)=> {
            if (idx<len-1)
                videoSpeed =  (video[idx+1].distance-m.distance)/(video[idx+1].time-m.time)*3.6;

            return {...m,videoSpeed}
        })

        const data:Partial<RouteInfo> = {
            distance: json.geometry.at(-1).distance,
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