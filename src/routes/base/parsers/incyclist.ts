import { EnhancedRoutePoint, GPXParser } from './gpx';
import { XMLParser, XmlParserContext } from './xml';


export class IncyclistXMLParser extends XMLParser{
    static SCHEME = 'gpx-import'

    
    protected async loadDescription(context: XmlParserContext): Promise<void> {
        await super.loadDescription(context)

        if (context.data['title']) 
            context.route.title = context.data['title']
    }

    protected async loadPoints(context: XmlParserContext): Promise<void> {
        const {data,fileInfo,route} = context
        
        const gpxFile = {...fileInfo}

        const xmlName = fileInfo.name
        const fileName = data['gpx-file-path']|| xmlName.replace('xml','gpx')

        if (fileName.startsWith('file')||fileName.startsWith('/')||fileName.startsWith('\\')||fileName.startsWith('.')) {
            gpxFile.type = 'file'
            gpxFile.filename = fileName
        }
        else if (fileName.startsWith('http')) {
            gpxFile.type = 'url'
            gpxFile.url = fileName
        }
        else {
            if (fileInfo.type==='url') {
                gpxFile.url = gpxFile.url.replace(xmlName,fileName)
            }
            else {
                gpxFile.filename = gpxFile.filename.replace(xmlName,fileName)

            }
        }

        const gpx = await new GPXParser({addTime:true}).import(gpxFile)
        route.points = gpx.details.points
    }


    protected async parseVideo(context: XmlParserContext): Promise<void> {

        await super.parseVideo(context)

        const {route} = context
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


    }
   

}