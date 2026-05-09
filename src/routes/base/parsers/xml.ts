import { EventLogger } from 'gd-eventlog';
import { JSONObject, XmlJSON, parseXml, toXml } from '../../../utils/xml';
import { RouteApiDetail } from '../api/types';
import { RouteInfo, RoutePoint } from '../types';
import { FileInfo, getBindings } from '../../../api';
import { checkIsLoop, getRouteHash, getTotalElevation,getTotalDistance, updateSlopes, validateRoute } from '../utils/route'
import { Position, Altitude } from './types';
import { getReferencedFileInfo, getUtf8Data, parseInformations } from './utils';
import { getFileName } from '../../../utils';

import type { ParseResult, Parser } from './types';

export interface  XmlParserContext  {
   fileInfo: FileInfo,
   data: JSONObject,
   route?: RouteApiDetail
}


/**
 * Base parser for XML-based route formats. Provides core functionality for parsing XML files
 * containing route data including waypoints, elevation, video information, and metadata.
 * Serves as the parent class for format-specific XML parsers (GPX, EPM, Incyclist, etc.).
 */
export class XMLParser implements Parser<XmlJSON,RouteApiDetail> {

    protected logger?: EventLogger

    /**
     * Imports XML route data from a file or provided data object.
     * @param file File information including path and metadata
     * @param data Optional pre-parsed XML data; if provided, file is not read
     * @returns Promise resolving to the parsed route data and metadata
     * @throws Error if the file cannot be opened or parsing fails
     */
    async import(file: FileInfo, data?: XmlJSON): Promise<ParseResult<RouteApiDetail>> {
        const xml = await this.getData(file,data)
        xml.expectScheme( this.getSupportedSheme())

        return await this.parse(file,xml)
    }

    /**
     * Gets the XML scheme identifier for this parser's supported format.
     * @returns The scheme string defined in the parser's static SCHEME property
     */
    getSupportedSheme():string {
        const C = this.constructor as typeof XMLParser

        return C['SCHEME']
    }

    /**
     * Returns the primary file extension supported by this parser.
     * @returns 'xml'
     */
    getPrimaryExtension(): string {
        return 'xml'
    }

    /**
     * Returns companion file extensions that can be imported with XML files.
     * @returns Empty array as base XML parser has no companion files
     */
    getCompanionExtensions(): string[]    {
        return []
    }


    /**
     * Checks if the given file extension is supported by this parser.
     * @param extension The file extension to check
     * @returns True if the extension is 'xml' (case-insensitive), false otherwise
     */
    supportsExtension(extension: string): boolean {
        return extension.toLowerCase()==='xml'
    }

    /**
     * Checks if the provided XML data contains content supported by this parser.
     * Validates that the XML contains the expected scheme/root element.
     * @param xmljson The parsed XML data to validate
     * @returns True if the XML contains the expected scheme element, false otherwise
     */
    supportsContent(xmljson: XmlJSON): boolean {
        const json = xmljson.json
        const scheme = this.getSupportedSheme()
        return json[scheme]!==undefined && json[scheme]!==null
    }


    /**
     * Retrieves XML data from a file or returns provided data.
     * @param file File information including path and metadata
     * @param data Optional pre-parsed XML data; returned directly if provided
     * @returns Promise resolving to the parsed XML as JSON
     * @throws Error if the file cannot be opened or XML parsing fails
     */
    async getData(file:FileInfo, data?:XmlJSON):Promise<XmlJSON> {
        if (data)
            return data

        const onError = ()=> {
            throw new Error('Could not open file: '+ getFileName(file))
        }

        const loader = getBindings().loader
        try {
            const res = await loader.open(file)
            if (res.error) {
                this.getLogger().logEvent({message:'[Parser] getData error', error:res.error})

                onError()
            }

            const resData:string = getUtf8Data(res.data)
            const xml = await parseXml(resData)

            return xml
        }
        catch (err:any) {
            this.getLogger().logEvent({message:'[Parser] getData error', error:err.message})
            onError()
        }
    }

    protected getCountryPrefix(title?:string):string|undefined {
        if (!title)
            return

        if (title.match(/^[A-z]{2}[-_].*/g)) {
            return title.substring(0,2)
        }
    }

    protected async loadDescription(context:XmlParserContext) {
        const data = context.data

        let name = data['name']
        const originalName = `${name}`
        let country = data['country']

        const countryPrefix = this.getCountryPrefix(name)
        if (countryPrefix) {
            name = name.substring(3)
            country = country??countryPrefix
        }

        let previewUrl = data['previewURL']
        if (previewUrl?.startsWith('https://www.reallifevideo.de/rlv.php'))
            previewUrl=undefined

        context.route= {
            title: name,
            originalName,
            localizedTitle: data['title']??name,
            country: country,
            id: data['id'],
            previewUrl,
            previewUrlLocal: data['preview'],
            distance:0,
            elevation:0,
            points:[],
            description: data['description1']
        };

        if (typeof context.route.localizedTitle==='string' ) {
            const lt = context.route.localizedTitle;
            context.route.localizedTitle= { en: lt}
        }
    }


    protected async parse(file: FileInfo, xmljson:XmlJSON ):Promise<ParseResult<RouteApiDetail>> {
        const data = xmljson.json

        const context:XmlParserContext = { fileInfo:file, data}

        await this.loadDescription(context)
        await this.loadPoints(context);
        this.validate(context)
        await this.parseVideo(context)

        const res = {
            data: await this.buildInfo(context),
            details: context.route
        }

        return res

    }

    /**
     * Validates the parsed route data and ensures all required fields are properly set.
     * Calculates total distance and elevation, and marks routes without points as disabled.
     * @param context The parser context containing the route to validate
     */
    validate(context:XmlParserContext) {
        const {route} = context
        validateRoute(route)
        route.distance = getTotalDistance(route)
        route.elevation = getTotalElevation(route)
        if (!route.points || route.points.length===0)
            route.gpxDisabled = true;

    }

    protected async loadPoints(context: XmlParserContext) {
        const {data} = context
        const positions = data['positions'];

        if (positions?.length > 0) {
            await this.loadElevationFromPositions(context);
        }
        else {
            await this.loadElevationFromAltitudes(context);
        }

    }

    /**
     * Builds route metadata and summary information from parsed data.
     * Generates route hash, determines if it's a loop, adds headings, and creates the RouteInfo object.
     * @param context The parser context containing the parsed route data
     * @returns Promise resolving to the complete route information
     */
    protected async buildInfo ( context:XmlParserContext):Promise<RouteInfo> {
        const {fileInfo,route} = context

        if (!route.id)
            route.id = getRouteHash(route)
        route.routeHash = getRouteHash(route)

        const localizedTitle = typeof(route.localizedTitle)==='string' ? {en:route.localizedTitle} : route.localizedTitle

        const info:RouteInfo ={
            id:route.id,
            originalName: route.originalName,
            title: route.title,
            localizedTitle,
            category:route.category,
            country:route.country,
            distance:route.distance,
            elevation:route.elevation,
            points: route.points,
            segments: route.video?.selectableSegments,
            requiresDownload: false,
            hasGpx: route.points?.length>0,
            hasVideo: true,
            isDemo: false,
            isLocal: true,
            isLoop: checkIsLoop(route.points),
            videoFormat: route.video.format,
            videoUrl: this.getVideoUrl(fileInfo,route),
            previewUrl: await getPreviewUrl(fileInfo,route),
            routeHash:route.routeHash

        }
        return info
    }


    protected getVideoUrl = (info:FileInfo,route: RouteApiDetail):string => {
        const {file,url} = route?.video||{}
        return getReferencedFileInfo(info,{file,url},'video')

    }

    protected async parseVideo (context:XmlParserContext) {
        const {data,route,fileInfo} = context

        const filePath = data['video-file-path'] as string


        let file,url
        if (filePath.startsWith('http')|| filePath.startsWith('file:') || filePath.startsWith('video:')) {
            url = filePath
        }
        else {
            file = filePath
        }

        route.video = {
            file,
            url,
            framerate: Number.parseFloat(data['framerate']),
            next: data['next-video'] ,
            mappings: [],
            format: undefined,
            selectableSegments:data['segments'],
        }
        route.infoTexts = parseInformations(data['informations'])
        route.next = route.video.next

        const videoUrl = this.getVideoUrl(fileInfo,route)
        if (videoUrl) {
            route.video.file = undefined;
            route.video.url = videoUrl
        }

        const fileParts = filePath.split('.');
        const extension = fileParts.at(-1);
        route.video.format = extension.toLowerCase()

        this.parseVideoMappings(context);

    }

    private parseVideoMappings(context:XmlParserContext) {
        const {data,route} = context
        const mappings = data['mappings'];

        if (mappings) {

            const startFrame = Number.parseInt(data['start-frame'] ?? 0);
            const endFrame = data['end-frame'] ? Number.parseInt(data['end-frame']) : undefined;

            try {
                let prev;
                let prevTime = 0;

                const getDistance = (mapping, prevMapping, idx?) => {
                    const prevDist = prevMapping.distance ?? 0;
                    const prevFrame = prevMapping.frame ?? startFrame;
                    if (mapping.distance !== undefined)
                        return mapping.distance;
                    if (prev.dpf !== undefined && mapping.frame !== undefined)
                        return prev.dpf * (mapping.frame - prevFrame) + prevDist;
                    throw new Error(`mapping #${idx ?? 'total'}: one of [distance], [dpf or frame] is missing: <mapping ${toXml(mapping)}/>`);
                };

                const initMapping =(mapping) =>{
                    mapping.distance = (mapping.distance !== undefined && mapping.distance !== null) ? Number.parseInt(mapping.distance) : undefined;
                    mapping.dpf = (mapping.dpf !== undefined && mapping.dpf !== null) ? Number.parseFloat(mapping.dpf) : undefined;
                    mapping.frame = (mapping.frame !== undefined && mapping.frame !== null) ? Number.parseInt(mapping.frame) : undefined;
                }

                const  addMapping = (mapping: any, prev: any, idx: any, startFrame: number, prevTime: number) => {
                    initMapping(mapping)

                    const distance = getDistance(mapping, prev, idx);

                    route.distance = mapping.distance = distance;

                    const frames = mapping.frame - (prev.frame ?? startFrame);
                    const videoSpeed = (prev.distance === undefined && mapping.dpf !== undefined) ? 3.6 * mapping.dpf * route.video.framerate : 3.6 * (distance - prev.distance) / frames * route.video.framerate;
                    const time = prevTime + frames / route.video.framerate;

                    route.video.mappings.push({ videoSpeed, time: prevTime, ...prev });

                    if (idx === mappings.length - 1) {
                        route.video.mappings.push({ videoSpeed, time, ...mapping });
                    }
                    return time;
                }



                mappings.forEach((mapping, idx) => {
                    if (idx === 0) {
                        initMapping(mapping);
                        prevTime = 0;
                    }
                    else {

                        if (mapping.frame == prev.frame || (mapping.distance !== undefined && mapping.distance===prev.distance))
                            return;

                        const time = addMapping(mapping, prev, idx, startFrame, prevTime);
                        prevTime = time;
                    }
                    prev = mapping;

                });

                if (endFrame && prev.dpf !== undefined) {
                    const mapping = { frame: endFrame, dpf: prev.dpf };

                    route.distance = getDistance(mapping, prev);

                }

            }
            catch (err) {
                this.getLogger().logEvent({ message: 'xml details', error: err.message, mappings });
                throw new Error('Could not parse XML File');
            }

        }

    }

    /**
     * Loads elevation data from a list of altitude records.
     * Maps altitude records to route distances and calculates slope information.
     * @param context The parser context containing the route to populate
     * @param tagName The XML tag name containing altitude data (default: 'altitudes')
     */
    async loadElevationFromAltitudes (context:XmlParserContext , tagName='altitudes')  {
        const {data,route} = context
        const altitudes =  data[tagName]
        if (!altitudes)
            return;


        route.points = altitudes.map(a => ({
            routeDistance: Number(a.distance),
            elevation: Number(a.height),
        }));


        route.points = route.points.filter( (p,idx) => {
            if (idx===0)
                return true
            return (p.routeDistance!==route.points[idx-1].routeDistance)
        })

        const points = route.points
        if (points?.length>0) {
            route.distance = points.at(-1).routeDistance
        }
        updateSlopes(points)

    }


    /**
     * Loads elevation and position data from lists of position and altitude records.
     * Combines GPS coordinates with elevation data to create complete route points.
     * @param context The parser context containing the route to populate
     * @param tags Optional custom tag names for altitude and position elements
     * @param tags.altitudes Tag name for altitude records (default: 'altitudes')
     * @param tags.positions Tag name for position records (default: 'positions')
     */
    async loadElevationFromPositions (context:XmlParserContext, tags?: {altitudes?: string,positions?:string})  {
        const {data,route} = context

        const altitudes =  data[tags?.altitudes || 'altitudes']
        const positions =  data[tags?.positions || 'positions']

        if (!positions)
            return;


        let prevAltitude = undefined;
        let prevDistance = 0;
        route.elevation = 0;
        const points = []

        positions.forEach( (pos,i) => {

            if (i>0) {
                const prev = positions[i-1]
                if (prev.distance===pos.distance) {
                    return
                }
            }

            const altitude = getAltitude(altitudes,positions,i,prevAltitude);
            const elevationGain = altitude-prevAltitude

            const pi  = createPoint(pos, altitude, prevDistance);
            pi.point.cnt = i
            points.push(pi.point);

            route.distance = pi.point.routeDistance;
            if (elevationGain>0)
                route.elevation+=elevationGain

            prevDistance = pi.prevDistance
            prevAltitude = altitude;
        })
        route.points = points;
        route.distance = prevDistance

        updateSlopes(route.points)

    }

    protected getLogger():EventLogger {
        this.logger = this.logger ?? new EventLogger('XML Parser')
        return this.logger
    }




}


const  getPreviewUrl = async (info:FileInfo,route: RouteApiDetail):Promise<string> => {
    // Preserve explicitly set previewUrl value from route (may be null or a string)
    if (route?.previewUrl !== undefined) {
        return route.previewUrl
    }

    const url = route?.previewUrl
    let file = route?.previewUrlLocal

    if (file) {
        const path= getBindings().path
        const fs = getBindings().fs
        const filename = file.startsWith(info.ext) || (/[A-Za-z]:.*/).exec(file) ? file : path.join(info.dir,file)
        const exists = await fs.existsFile(filename)
        if (!exists)
            file=undefined

    }
    return getReferencedFileInfo(info,{file,url},'file')
}


function createPoint(pos: Position, altitude: number, prevDistance: number) {
    const point:RoutePoint = {
        lat: Number(pos.lat),
        lng: Number(pos.lon),
        routeDistance: Number(pos.distance),
        elevation: altitude,
        slope: 0,
        distance: undefined
    };

    if (prevDistance === undefined) {
        point.routeDistance = 0;
        point.distance = 0;
        prevDistance = 0;
    }
    else {
        point.distance = point.routeDistance - prevDistance;
        prevDistance = point.routeDistance;
    }
    return { point, prevDistance };
}

function getAltitude( altitudes:Array<Altitude>, positions: Array<Position>, i:number, prevAltitude: number) {
    const pos = positions[i]
    let height = altitudes[i]?.height;

    if (altitudes && Array.isArray(altitudes)) {

        if (altitudes[i] && Number.parseInt(altitudes[i].distance) === Number.parseInt(pos.distance)) {
            return height!==undefined ? Number(height) : prevAltitude
        }
        else {
            const altFound = altitudes.find(a => Number.parseInt(a.distance) === Number.parseInt(pos.distance));
            height = altFound?.height
            return  height!==undefined ? Number(height) : prevAltitude;
        }
    }
}

