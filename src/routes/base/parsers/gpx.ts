import { geo } from "../../../utils"
import { num } from "../../../utils/math";
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
    keepZero?: boolean
    duration?: number
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

        const metadata = data['metadata'] ?? {}
        const track = Array.isArray(data['trk']) ? data['trk'][0] : data['trk']
        if (!track)  {
            throw new Error('no track found')
        }

        context.route= {
            title: metadata['name'] ?? context.fileInfo.name,
            localizedTitle: track['title'] ?? track['name'],
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

    protected getNumberOfPoints(context:XmlParserContext):number { 
        const data = context.data 
        const track = Array.isArray(data['trk']) ? data['trk'][0] : data['trk']

        const segments = Array.isArray(track.trkseg) ? track.trkseg : [track.trkseg]

        return segments.reduce( (sum,segment) => {
            let pts = 0
            if (Array.isArray(segment?.trkpt))
                pts = segment.trkpt.length
            if ( typeof(segment?.trkpt)==='object' && Object.keys(segment?.trkpt ) ) {
                const keys = Object.keys(segment?.trkpt)
                pts = keys.length
            }
            return sum + pts
        },0) 

    }

    protected hasTimestamps(context:XmlParserContext):boolean {
        const data = context.data 
        const track = Array.isArray(data['trk']) ? data['trk'][0] : data['trk']

        const segments = Array.isArray(track.trkseg) ? track.trkseg : [track.trkseg]

        for (const segment of segments) {
            let points = []
            if (Array.isArray(segment?.trkpt))
                points = segment.trkpt
            if ( typeof(segment?.trkpt)==='object' && Object.keys(segment?.trkpt ) ) {
                const keys = Object.keys(segment?.trkpt)
                points = keys.map( key=>segment?.trkpt[key])
            }   
            if (points?.some( (p) => p.time )) {
                return true
            }
        }

        return false
    }

    // adjust times based on average speed
    protected async adjustTimes (context:XmlParserContext) { 
        const totalDistance = context.route.points.length>0 ? context.route.points[context.route.points.length-1].routeDistance : 0
        const avgSpeed = totalDistance / this.props.duration; // m/s

        for (const p of context.route.points) {
            p.time = p.routeDistance / avgSpeed;
        }

    }


    protected async loadPoints(context: XmlParserContext) {
        const data = context.data 
        const track = Array.isArray(data['trk']) ? data['trk'][0] : data['trk']

        const segments = Array.isArray(track.trkseg) ? track.trkseg : [track.trkseg]
        let prev;
        let startTime=null
        let stepSize = 1
        let useAverageSpeed = false

        if (this.props.duration) { 



            const totalPoints = this.getNumberOfPoints(context)
            const hasTimestamps = this.hasTimestamps(context)
            if (!hasTimestamps) {
                useAverageSpeed = true
            }
            if (totalPoints && totalPoints>0) {
                stepSize = this.props.duration / totalPoints
            }
        }

        
    
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
                    lat:num(gpxPt.lat),
                    lng:num(gpxPt.lon),
                    elevation: gpxPt.ele ? num(gpxPt.ele): prev?.elevation,
                    routeDistance:0,
                    distance:0
                }

                if (point.lat===undefined || point.lng===undefined) {
                    const info = {
                        original: gpxPt,
                        parsed: point
                    }
                    this.logger.logEvent({ message:'error', fn:'loadPoints',reason:'unvalid point', info})
                    return
                }
                
                if (this.props.addTime) {

                    if (startTime===null) {
                        point.time = 0;
                        startTime = gpxPt.time ? Date.parse(gpxPt.time) : Date.now();
                    }
                    else {
                        const gpxTime = gpxPt.time ? (Date.parse(gpxPt.time)-startTime)/1000 : null;                       
                        point.time = gpxTime ?? prev.time+stepSize
                    }


                }

                
                if (prev) {
                    const ignore = this.caclulateDistance(point,prev)
                    if (ignore && !this.props.keepZero) {
                        return
                    }
                }


                point.cnt = context.route.points.length
                context.route.points.push(point)
                prev = point
                
            })
        })

        if (useAverageSpeed) {

            this.adjustTimes(context)
        }


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
            p.heading = heading??prevHeading
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