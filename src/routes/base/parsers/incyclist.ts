import { JSONObject, parseTime } from '../../../utils';
import { RouteApiDetail } from '../api/types';
import { RoutePoint } from '../types';
import { validateRoute } from '../utils';
import { fixAnomalies } from '../utils/points';
import { EnhancedRoutePoint, GPXParser } from './gpx';
import { CutInfo } from './types';
import { XMLParser, XmlParserContext } from './xml';


export class IncyclistXMLParser extends XMLParser{
    static readonly SCHEME = 'gpx-import'

    
    protected async loadDescription(context: XmlParserContext): Promise<void> {
        await super.loadDescription(context)

        const title = context.data['title']
        if (title) {
            
            if (typeof title==='string') {
                context.route.title = title
            }
            else if (typeof title==='object') {
                 const language = Object.keys(title)[0]
                 context.route.title = title[language]
             }
            
        }
    }

    protected async loadPoints(context: XmlParserContext): Promise<void> {
        const {data,fileInfo,route} = context
        
        const gpxFile = {...fileInfo}

        const xmlName = fileInfo.name
        const fileName = data['gpx-file-path']?? xmlName.replace('xml','gpx')

        if (fileName.startsWith('file')||fileName.startsWith('/')||fileName.startsWith('\\')||fileName.startsWith('.')) {
            gpxFile.type = 'file'
            gpxFile.filename = fileName
        }
        else if (fileName.startsWith('http')) {
            gpxFile.type = 'url'
            gpxFile.url = fileName
        }
        else if (fileInfo.type==='url') {
                gpxFile.url = gpxFile.url.replace(xmlName,fileName)
        }
        else {
            gpxFile.filename = gpxFile.filename.replace(xmlName,fileName)

        }

        try {
            if (context.data['autoCorrect']) {
                const gpx = await new GPXParser({addTime:true, keepZero:true}).import(gpxFile)
                route.points = gpx.details.points
    
                fixAnomalies(route.points)    
                validateRoute(route)
            }
            else {
                const gpx = await new GPXParser({addTime:true}).import(gpxFile)
                route.points = gpx.details.points
                    
            }
        }
        catch(err) {            
            if (!data['gpx-file-path'])
                throw new Error('<gpx-file-path> missing in XML')    
            throw err
        }

    }

    protected processCuts(data:JSONObject,route:RouteApiDetail):void { 
        const cuts = data['cuts']
        cuts?.forEach( cut => {
            const timeStr = cut['time']
            const time = parseTime(timeStr)
            const cutInfo:CutInfo = {time, startFrame:cut['start-frame'], endFrame:cut['end-frame']}

            const mappings = route.video.mappings
            const points = route.points
            if (!mappings || !points)
                return;

            const mappingAtCutIdx = mappings.findIndex( p => p.time===cutInfo.time)
            const mappingAtCut = mappings[mappingAtCutIdx]
            const mappingBeforeCut = mappings[mappingAtCutIdx-1]
            
            // find nearest point in points based on route.routeDistance and mappings.distance
            const distanceToCut = points.map( (p,index)=> {
                const distance = Math.abs(p.routeDistance-mappingAtCut.distance)
                return {index,distance}
            }).sort( (a,b) => a.distance-b.distance)

            const pointAtCut = points[distanceToCut[0].index]
            const pointBeforeCut = points[distanceToCut[0].index-1]

            const v = mappingAtCut.videoSpeed/3.6
            const t = mappingAtCut.time-mappingBeforeCut.time
            const distanceAtCutStart = pointAtCut.routeDistance-v*t
            const offset = distanceAtCutStart-pointBeforeCut.routeDistance

            pointAtCut.routeDistance-=offset
            pointAtCut.distance-=offset
            pointAtCut.isCut = true
            points.forEach( (p,idx) => {
                if (idx>distanceToCut[0].index) {
                    p.routeDistance-=offset
                }
            })


            mappingBeforeCut.videoSpeed = mappingAtCut.videoSpeed
            mappings.forEach( (m,idx) => { 
                if (idx>=mappingAtCutIdx) {
                    m.distance-=Math.round(offset)
                }
            })
            

        })

        route.distance = route.points[route.points.length-1].routeDistance

    }


    protected async parseVideo(context: XmlParserContext): Promise<void> {

        await super.parseVideo(context)

        const {data,route} = context
        const points = route.points as Array<EnhancedRoutePoint>

        route.video.mappings =  points.map( (p,idx) => {
            const time = p.time
            
            let videoSpeed;
            if (idx!==points.length-1) {
                    videoSpeed = (points[idx+1].routeDistance-p.routeDistance)/(points[idx+1].time-p.time)*3.6;                
            }
            else {
                videoSpeed = points[idx-1].videoSpeed
            }

            const distance = Math.round(p.routeDistance);
            const frame = Math.round(p.time*route.video.framerate);

            delete p.time;

            return {time,videoSpeed,distance,frame};            
        })


        if (data['cuts']) {
            this.processCuts(data,route)
        }

        if (data['elevation-shift'])
            this.processElevationShift( Number(data['elevation-shift']) ,route.points)
        


    }

    protected processElevationShift(elevationShift:number,points:RoutePoint[]):void { 

        
        if (!elevationShift ||!points || points.length<2 || points.length<elevationShift)
            return;

        const cuts = points.filter( p => p.isCut) || []
        const lastPoints = []
        cuts.forEach(cut => {
            lastPoints.push( points[cut.cnt-1])
        })
        lastPoints.push(points[points.length-1])

        let idx = 0;
        let prev = undefined
        lastPoints.forEach( lp => {
            
            const lastIdx = lp.cnt;
            const lastSlope = lp.slope
            let lastElevation = lp.elevation
            while (idx+elevationShift<=lastIdx) {
                points[idx].elevation = points[idx+elevationShift].elevation
                points[idx].slope = points[idx+elevationShift].slope
                points[idx].elevationGain = points[idx+elevationShift].elevationGain
                idx++
            }
            while(idx<=lastIdx) {                
                points[idx].elevation = lastElevation+lastSlope*points[idx].distance/100;
                points[idx].elevationGain += (points[idx].elevation-lastElevation)
                lastElevation = points[idx].elevation
                idx++
            }
        })

        
    }
   

}