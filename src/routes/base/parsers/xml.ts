import { EventLogger } from 'gd-eventlog';
import { XmlJSON, toXml } from '../utils/xml';
import { RouteApiDetail } from '../api/types';
import { ParseResult, Parser, RouteInfo, RoutePoint } from '../types';
import { JSONObject } from '../../../api';
import { checkIsLoop, updateSlopes } from '../utils/route';
import { Position, Altitude } from './types';

let _logger;

export abstract class XMLParser implements Parser<XmlJSON,RouteApiDetail> {


    async import(xml: XmlJSON): Promise<ParseResult<RouteApiDetail>> {       
        xml.expectScheme( this.getSupportedSheme())        
        return this.parse(xml)        
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
        return json.kwt!==undefined && json.kwt!==null
    }

    protected parse( xmljson:XmlJSON ):ParseResult<RouteApiDetail> {
   
        const data = xmljson.json 
    
        const  route:RouteApiDetail = {
            title: data.name,
            localizedTitle: data.title || data.name,
            country: data.country,
            id: data.id,
            category: 'personal',
            previewUrl: data.previewURL,
            distance:0,
            elevation:0,
            points:[],
            description: data.description1
        };

    
        const positions = data.positions   
    
        if (positions?.length>0 ) {
            loadElevationFromPositions(data, route);
        }
        else {
            loadElevationFromAltitudes(data, route);
        }
        parseVideo(data,route)
    
        const res = {
            data: buildInfo(route),
            details: route
        }
    
        return res
    
    }
    


}


const buildInfo = ( route:RouteApiDetail):RouteInfo => {
    const info:RouteInfo ={
        id:route.id,
        title: route.title,
        localizedTitle: route.localizedTitle,
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
        videoUrl: getVideoUrl(route),
        previewUrl: getPreviewUrl(route)

    }
    return info
}


const getVideoUrl = (route: RouteApiDetail):string => {
    return 'url'
}

const getPreviewUrl = (route: RouteApiDetail):string => {
    return 'url'
}


const parseVideo = (json:JSONObject, route: RouteApiDetail)=> {
    route.video = {
        file: json['video-file-path'],
        url:undefined,
        framerate: parseFloat(json['framerate']),                
        next: json['next-video'] ,
        mappings: [],
        format: undefined,
        selectableSegments:json['segments'],
        infoTexts: json['informations'],        
    }

    console.log(route.video)
    const fileParts = route.video.file.split('.');

    const extension = fileParts[fileParts.length-1];            
    route.video.format = extension.toLowerCase()

    const mappings = json['mappings']

    if ( mappings ) {
        
        let prev;
        let prevTime =0;
       

        const startFrame = parseInt(json['start-frame']||0 )
        const endFrame = json['end-frame'] ? parseInt(json['end-frame']) : undefined;
        
        try {

            const getDistance = (mapping,prevMapping,idx?) => {
                const prevDist = prevMapping.distance || 0;
                const prevFrame = prevMapping.frame || startFrame;
                if (mapping.distance!==undefined)
                    return mapping.distance;
                if (prev.dpf!==undefined && mapping.frame!==undefined)
                    return  prev.dpf*(mapping.frame-prevFrame)+prevDist
                throw new Error(`mapping #${idx||'total'}: one of [distance], [dpf or frame] is missing: <mapping ${toXml(mapping) }/>`)
            }


            mappings.forEach ( (mapping,idx) => {
                if (idx!==0) {
               
                    mapping.distance = (mapping.distance!==undefined && mapping.distance!==null) ? parseInt(mapping.distance) : undefined;
                    mapping.dpf = (mapping.dpf!==undefined && mapping.dpf!==null) ? parseFloat(mapping.dpf) : undefined;
                    mapping.frame = (mapping.frame!==undefined && mapping.frame!==null) ? parseInt(mapping.frame) : undefined


                    const distance = getDistance(mapping,prev,idx)
                    //if (idx===1) console.log(distance,prev,mapping)
                    route.distance = mapping.distance = distance;

                    const frames = mapping.frame-(prev.frame||startFrame);
                    const videoSpeed = (prev.distance===undefined && mapping.dpf!==undefined) ? 3.6*mapping.dpf* route.video.framerate : 3.6 * (distance-prev.distance) / frames * route.video.framerate
                    const time = prevTime + frames/route.video.framerate ;
                    
                    route.video.mappings.push ( { videoSpeed,time:prevTime, ...prev})
                    //if (idx<10) console.log(frames,prev, { videoSpeed,time,endFrame:mapping.frame, ...prev})
                    prev = mapping;
                    prevTime = time;
                    

                    if ( idx===mappings.length-1) {
                        route.video.mappings.push ( { videoSpeed, time,...mapping})
                    }

                }
                else {
                    mapping.distance = (mapping.distance!==undefined && mapping.distance!==null) ? parseInt(mapping.distance) : undefined;
                    mapping.dpf = (mapping.dpf!==undefined && mapping.dpf!==null) ? parseFloat(mapping.dpf) : undefined;
                    mapping.frame = (mapping.frame!==undefined && mapping.frame!==null) ? parseInt(mapping.frame) : undefined


                    prev = mapping
                    prevTime = 0;

                }
            })

            if ( endFrame && prev.dpf!==undefined) {
                const mapping  = {frame:endFrame, dpf:prev.dpf};
                
                route.distance = getDistance(mapping,prev);

            }

        }
        catch(err) {
            if (!_logger) _logger = new EventLogger('XmlParser');
            _logger.logEvent({message:'xml details',error:err.message, mappings});
             throw new Error( 'Could not parse XML File' );
        }
         
    }

}



const loadElevationFromAltitudes = (json:JSONObject, route: RouteInfo) => {
    
    const altitudes =  json['altitudes']
    if (!altitudes)
        return;

    
    route.points = altitudes.map(a => ({
        routeDistance: Number(a.distance),
        elevation: Number(a.height),
    }));

    const points = route.points as Array<RoutePoint>
    if (points?.length>0) {
        route.distance = points[points.length-1].routeDistance
    }
    updateSlopes(points)
    
}


const loadElevationFromPositions = (json: JSONObject, route: RouteInfo) => {
    const altitudes =  json['altitudes']
    const positions =  json['positions']

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

function createPoint(pos: Position, altitude: number, prevDistance: number) {
    const point = {
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

