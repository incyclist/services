import { EventLogger } from 'gd-eventlog';
import { JSONObject, XmlJSON, parseXml, toXml } from '../../../utils/xml';
import { RouteApiDetail } from '../api/types';
import { ParseResult, Parser, RouteInfo, RoutePoint } from '../types';
import { FileInfo, getBindings } from '../../../api';
import { checkIsLoop, getRouteHash, getTotalElevation,getTotalDistance, updateSlopes, validateRoute } from '../utils/route'
import { Position, Altitude } from './types';
import { getReferencedFileInfo, parseInformations } from './utils';
import { getFileName } from '../../../utils';

let _logger;

export type  XmlParserContext = {
   fileInfo: FileInfo,
   data: JSONObject,
   route?: RouteApiDetail
}


export class XMLParser implements Parser<XmlJSON,RouteApiDetail> {


    async import(file: FileInfo, data?: XmlJSON): Promise<ParseResult<RouteApiDetail>> {       
        const xml = await this.getData(file,data)
        xml.expectScheme( this.getSupportedSheme())        
        
        return await this.parse(file,xml)        
    }

    getSupportedSheme():string {
        const C = this.constructor as typeof XMLParser     
            
        return C['SCHEME']        
    }

    
    supportsExtension(extension: string): boolean {
        return extension.toLowerCase()==='xml'
    }
    supportsContent(xmljson: XmlJSON): boolean {
        const json = xmljson.json 
        const scheme = this.getSupportedSheme()
        return json[scheme]!==undefined && json[scheme]!==null
    }

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
                onError()                
            }
            const xml = await parseXml(res.data)
            return xml
        }
        catch {
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
            country = country || countryPrefix
        }

        let previewUrl = data['previewURL']
        if (previewUrl?.startsWith('https://www.reallifevideo.de/rlv.php')) 
            previewUrl=undefined

        context.route= {
            title: name,
            originalName,
            localizedTitle: data['title'] || name,
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
            previewUrl: getPreviewUrl(fileInfo,route),
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
        if (filePath.startsWith('http:')|| filePath.startsWith('file:') || filePath.startsWith('video:')) {
            url = filePath            
        }
        else {
            file = filePath
        }

        route.video = {
            file,
            url,
            framerate: parseFloat(data['framerate']),                
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
        const extension = fileParts[fileParts.length-1];            
        route.video.format = extension.toLowerCase()

        this.parseVideoMappings(context);
    
    }
    
    private parseVideoMappings(context:XmlParserContext) {
        const {data,route} = context
        const mappings = data['mappings'];

        if (mappings) {

            const startFrame = parseInt(data['start-frame'] || 0);
            const endFrame = data['end-frame'] ? parseInt(data['end-frame']) : undefined;

            try {
                let prev;
                let prevTime = 0;
    
                const getDistance = (mapping, prevMapping, idx?) => {
                    const prevDist = prevMapping.distance || 0;
                    const prevFrame = prevMapping.frame || startFrame;
                    if (mapping.distance !== undefined)
                        return mapping.distance;
                    if (prev.dpf !== undefined && mapping.frame !== undefined)
                        return prev.dpf * (mapping.frame - prevFrame) + prevDist;
                    throw new Error(`mapping #${idx || 'total'}: one of [distance], [dpf or frame] is missing: <mapping ${toXml(mapping)}/>`);
                };

                const initMapping =(mapping) =>{
                    mapping.distance = (mapping.distance !== undefined && mapping.distance !== null) ? parseInt(mapping.distance) : undefined;
                    mapping.dpf = (mapping.dpf !== undefined && mapping.dpf !== null) ? parseFloat(mapping.dpf) : undefined;
                    mapping.frame = (mapping.frame !== undefined && mapping.frame !== null) ? parseInt(mapping.frame) : undefined;
                }

                const  addMapping = (mapping: any, prev: any, idx: any, startFrame: number, prevTime: number) => {
                    initMapping(mapping)
        
                    const distance = getDistance(mapping, prev, idx);
                    
                    route.distance = mapping.distance = distance;
        
                    const frames = mapping.frame - (prev.frame || startFrame);
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
                if (!_logger) _logger = new EventLogger('XmlParser');
                _logger.logEvent({ message: 'xml details', error: err.message, mappings });
                throw new Error('Could not parse XML File');
            }

        }

    }

    async loadElevationFromAltitudes (context:XmlParserContext , tagName='altitudes')  {
        const {data,route} = context
        const altitudes =  data[tagName]
        if (!altitudes)
            return;
    
        
        route.points = altitudes.map(a => ({
            routeDistance: Number(a.distance),
            elevation: Number(a.height),
        }));
    
        const points = route.points
        if (points?.length>0) {
            route.distance = points[points.length-1].routeDistance
        }
        updateSlopes(points)
        
    }
    
    
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
    


}







const getPreviewUrl = (info:FileInfo,route: RouteApiDetail):string => {
    const url = route?.previewUrl 
    let file = route?.previewUrlLocal

    if (file) {
        const path= getBindings().path
        const fs = getBindings().fs
        const filename = file.startsWith(info.ext) || (/[A-Za-z]:.*/).exec(file) ? file : path.join(info.dir,file)
        if (!fs.existsSync(filename))
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

        if (altitudes[i] && parseInt(altitudes[i].distance) === parseInt(pos.distance)) {
            return height!==undefined ? Number(height) : prevAltitude
        }
        else {
            const altFound = altitudes.find(a => parseInt(a.distance) === parseInt(pos.distance));
            height = altFound?.height
            return  height!==undefined ? Number(height) : prevAltitude;
        }
    }    
}

