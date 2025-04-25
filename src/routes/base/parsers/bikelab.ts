import { RoutePoint, VideoRoutePoint } from '../types';
import { XMLParser, XmlParserContext } from './xml';


export type MappingRecord = {
    time: number,
    distance: number,
    videoSpeed?:number,
}

const addVideoSpeed = (points:Array<RoutePoint>,mappings:Array<MappingRecord>):Array<VideoRoutePoint> => {
    let prevSpeed ;
    let prevTime ;
    let videoIdx = 0;

    return points.map ( (point,idx) => {

        const p:VideoRoutePoint = {...point, videoSpeed:undefined, videoTime:undefined}

        if (idx===0) {
            p.videoSpeed = mappings[0].videoSpeed;
            p.videoTime = mappings[0].time;
            prevSpeed = p.videoSpeed;
            prevTime = p.videoTime;
        }
        else {
            if (p.routeDistance<=mappings[videoIdx].distance) {
                p.videoSpeed = prevSpeed;
                p.videoTime = prevTime;
            }

            while (videoIdx<mappings.length && p.routeDistance>mappings[videoIdx].distance) 
                videoIdx++;
            
            if (videoIdx<mappings.length) {
                
                p.videoSpeed = mappings[videoIdx].videoSpeed;
                const v = p.videoSpeed/3.6;

                p.videoTime = mappings[videoIdx].time - (mappings[videoIdx].distance-p.routeDistance)/v;
                prevSpeed = p.videoSpeed;
                prevTime = p.videoTime; 
            }
    
        }
        return p;

    })
}

export class BikeLabParser extends XMLParser{
    static readonly SCHEME = 'Track'
    
    protected async loadDescription(context: XmlParserContext): Promise<void> {
        const {data} = context

        const value =(name) => {
            const val = data[name]
            if (!val || val['xsi:nil'])
                return null;
            return val
        }
        

        context.route= {
            title: value('Description') ?? value('Name'),
            localizedTitle: value('Description') ?? value('Name'),
            country: value('CountryCode'),
            id: value('id'),
            previewUrl: value('previewURL'),
            distance:0,
            elevation:0,
            points:[],
            description: undefined
        };

        if (Number(context.route.country)===0 )
            context.route.country = undefined

        if (typeof context.route.localizedTitle==='string' ) {
            const lt = context.route.localizedTitle;
            context.route.localizedTitle= { en: lt}
        }        
    }


    protected async loadPoints(context: XmlParserContext): Promise<void> {
        const {data,route} = context

        const positions = data['AltitudePoints']??[]
        route.points = positions.map( p=> ({
            lat:Number(p.Lat),
            lng:Number(p.Lng),
            routeDistance:Number(p.Distance),
            elevation:Number(p.Alt)
        }))
    }

    protected async parseVideo(context: XmlParserContext): Promise<void> {
        const {data,route,fileInfo} = context


        route.video = {
            file: data['Video'],
            url:undefined,
            next: data['next-video'] ,
            mappings: [],
            format: undefined,
            framerate: undefined,
            selectableSegments:undefined,
        }

        const fileParts = route.video.file.split('.');
        const extension = fileParts[fileParts.length-1];            
        route.video.format = extension.toLowerCase()

        const videoPoints = data['VideoPoints']??[]

        let prev=undefined;
        route.video.mappings = videoPoints.map( m => {
            const mapping:MappingRecord = {
                time:Number(m.VideoTime),
                distance:Number(m.Distance),
               
            }
            if (prev && prev.time!==undefined && prev.distance!==undefined)
                mapping.videoSpeed  = (mapping.distance-prev.distance) / (mapping.time - prev.time) * 3.6;
            prev = mapping;
            return mapping;
        });


        const videoUrl = this.getVideoUrl(fileInfo,route)
        if (videoUrl) {
            route.video.file = undefined;
            route.video.url = videoUrl
        }


        // add video speed data
        addVideoSpeed(route.points,route.video.mappings);
    }
}
