import { geo } from "../../../utils"
import { valid } from "../../../utils/valid";
import { RouteInfo, RoutePoint } from "../types"
import { checkIsLoop, getRouteHash } from "../utils/route"
import { XMLParser, XmlParserContext } from "./xml"


const MIN_DISTANCE = 1;

export interface EnhancedRoutePoint extends RoutePoint {
    time?: number
}

interface GPXParserProps {
    addTime?: boolean;
}

export class GPXParser extends XMLParser { 
    protected static SCHEME = 'gpx'

    protected props:GPXParserProps

    constructor(props:GPXParserProps={} ) {
        super()
        this.props = props;
    }



    supportsExtension(extension) {
        return extension.toLowerCase() === 'gpx';
    }

    protected async loadDescription(context:XmlParserContext) {
        const data = context.data 

        const metadata = data['metadata'] || {}
        const track = Array.isArray(data['trk']) ? data['trk'][0] : data['trk']
        if (!track)  {
            throw new Error('no track found')
        }

        context.route= {
            title: metadata['name'] || context.fileInfo.name,
            localizedTitle: track['title'] || track['name'],
            country: undefined,
            id: undefined,
            previewUrl: undefined,
            distance:0,
            elevation:0,
            points:[],
            description: track['desc']
        };

        if (typeof context.route.localizedTitle==='string' ) {
            const lt = context.route.localizedTitle;
            context.route.localizedTitle= { en: lt}
        }
    }
 

    protected async loadPoints(context: XmlParserContext) {
        const data = context.data 
        const track = Array.isArray(data['trk']) ? data['trk'][0] : data['trk']

        const segments = Array.isArray(track.trkseg) ? track.trkseg : [track.trkseg]
        let prev;
        let startTime=null
        

        segments.forEach( segment => {
            let points = []
            if (Array.isArray(segment?.trkpt))
                points = segment.trkpt
            if ( typeof(segment?.trkpt)==='object' && Object.keys(segment?.trkpt ) ) {
                const keys = Object.keys(segment?.trkpt)
                points = keys.map( key=>segment?.trkpt[key])
            }

            points.forEach( (gpxPt)=> {
                const point:EnhancedRoutePoint = {
                    lat:Number(gpxPt.lat),
                    lng:Number(gpxPt.lon),
                    elevation: gpxPt.ele ? Number(gpxPt.ele): undefined,
                    routeDistance:0,
                    distance:0
                }
                
                if (this.props.addTime) {
                    point.time = startTime===null ? 0: (Date.parse(gpxPt.time)-startTime)/1000;
                    if ( startTime===null)
                        startTime = Date.parse(gpxPt.time);

                }

                
                if (prev) {
                    const ignore = this.caclulateDistance(point,prev)
                    if (ignore) {
                        return
                    }
                }


                point.cnt = context.route.points.length
                context.route.points.push(point)
                prev = point
            })
        })

    }

    protected caclulateDistance(point:RoutePoint,prev:RoutePoint):boolean {

        
        if (prev) {
            const s = Math.abs(geo.calculateDistance( prev.lat, prev.lng, point.lat, point.lng));
            
            point.distance+=s;
            point.distance = s;
            point.routeDistance =  prev.routeDistance +s;

            if (s<MIN_DISTANCE) {
                return true
            }
        }
        else {
            point.distance = 0;
            point.routeDistance = 0;
        }
        return false;
    }




    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    protected async parseVideo (context:XmlParserContext) {
        // no video in GPX fies, i.e. nothing to do
    }

    protected async addHeadings(points:Array<RoutePoint>,isLoop:boolean) {

        let prevHeading:number;

        points.forEach( (p,idx) => {
            if (valid(p.heading)) {
                prevHeading = p.heading
                return;
            }

            let pNext;
            if (idx===points.length-1) {
                pNext = isLoop ? points[0] : undefined;
            }
            else {
                pNext = points[idx+1]
            }
            const heading = geo.calculateHeaderFromPoints(p,pNext)
            p.heading = heading!==undefined  ? heading : prevHeading
            prevHeading = p.heading
        })
    }
    
    protected async buildInfo ( context:XmlParserContext):Promise<RouteInfo> {
        const {route} = context

        route.routeHash = getRouteHash(route)
        if (!route.id)
            route.id = route.routeHash
        
        const isLoop = checkIsLoop(route.points);
        const localizedTitle = typeof(route.localizedTitle)==='string' ? {en:route.localizedTitle} : route.localizedTitle 

        const info:RouteInfo ={
            id:route.id,
            title: route.title,
            localizedTitle,
            country:route.country,
            distance:route.distance,
            elevation:route.elevation,
            points: route.points,
            requiresDownload: false,
            hasGpx: route.points?.length>0,
            hasVideo: false,
            isDemo: false,
            isLocal: true,
            isLoop,
            previewUrl: undefined    
        }

        this.addHeadings(route.points,isLoop)
        return info
    }

}