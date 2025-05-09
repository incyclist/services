import { FileInfo, getBindings } from '../../../api';
import { RouteApiDetail } from '../api/types';
import { DaumEpp, DaumEppProgramEntry, RouteInfo, RoutePoint} from '../types';
import { JSONObject } from '../../../utils/xml';
import { BinaryReader } from './utils';
import { XMLParser, XmlParserContext } from './xml';
import { getFileName } from '../../../utils';

export interface EpmParserContext extends XmlParserContext {
    noPositions?:boolean
}

export class EPMParser extends XMLParser{
    static readonly SCHEME = 'roadmovie'
    
    supportsExtension(extension) {
        return extension.toLowerCase() === 'epm';
    }

    protected async loadPoints(context: EpmParserContext) { 
        const {data,route} = context

        route.points=[]
        const positions = data['positions']?.length ? data['positions'] : []

        let prevDistance=undefined
        positions.forEach( (pos,idx)=> {

            if (typeof pos.lat ==='string' && pos.lat.includes(',') &&!pos.lat.includes('.') )
                pos.lat = pos.lat.replace(',','.')
            if (typeof pos.lon ==='string' && pos.lon.includes(',') &&!pos.lon.includes('.') )
                pos.lon = pos.lon.replace(',','.')
            if (typeof pos.distance ==='string' && pos.distance.includes(',') &&!pos.distance.includes('.') )
                pos.distance = pos.distance.replace(',','.')
            
            const point = {
                lat:Number(pos.lat), 
                lng:Number(pos.lon),
                routeDistance:Number(pos.distance),
                distance:undefined,
                elevation:Number(pos.height),
                slope:0
            }
            if (idx===0) {
                point.routeDistance = 0;
                point.distance=0;
                prevDistance = 0;
            }
            else {                        
                point.distance = point.routeDistance-prevDistance;
                prevDistance = point.routeDistance;
            }

            route.points.push(point)
        })

        if (route.points.length===0)
            context.noPositions = true
    }

    protected async loadEpp(context:EpmParserContext):Promise<Buffer> {
        const {fileInfo} = context
        

        const file:FileInfo = {...fileInfo,ext:'epp',encoding:'binary'}
    
        const fileName = fileInfo.name.replace('epm','epp')

        if (fileName.startsWith('http')||fileName.startsWith('file')||fileName.startsWith('/')||fileName.startsWith('\\')||fileName.startsWith('.')) {
            file.type = 'file'
            file.filename = fileName
        }
        else if (fileInfo.type==='url') {
                file.url = file.url.replace(fileInfo.name,fileName)
        }
        else {
            file.filename = file.filename.replace(fileInfo.name,fileName)

        }


        const onError = ()=> {
            throw new Error('Could not open EPP file: '+ getFileName(file))
        }

        const loader = getBindings().loader
        try {
            const res = await loader.open(file)
            if (res.error) {
                onError()
            }
            return res.data
        }
        catch {
            onError()
        }
    }

    protected getV7Program(reader:BinaryReader,json):DaumEpp {

        const num = (reader.length-388)/12;
    
        reader.ReadString(4);
        json.min = reader.ReadUint32();
        json.max = reader.ReadUint32();
        json.cnt =  reader.ReadUint32();
        json.sampleRate =  reader.ReadUint32();
        json.validFor = reader.ReadUint32();  //BITs: 1: bike, 2: lyps, 4: run
        json.elevationStart = reader.ReadFloat();
        json.powerLimit = reader.ReadUint16();
        json.hrmLimit = reader.ReadUint16();
        json.speedLimit = reader.ReadFloat();
        reader.ReadString(8);
        json.programData = [];
        let distance = 0;
        for ( let i= 0; i<num; i++ ) {
            const sampleRate = reader.ReadUint32();
            const value = reader.ReadFloat();
            const _ignore = reader.ReadFloat();
            if ( sampleRate === json.sampleRate) {
                json.programData.push({elevation:value, x:_ignore, distance});
                distance+=json.sampleRate;
            }
        }
        return json
    }


    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    getV6Program(_reader,_json):DaumEpp {
        throw new Error('Unsupported Program Version ')
    }

    protected createNoGpxRouteFromEpmEpp(route,epp) {
        route.points = epp.programData.map( p =>  ({ routeDistance:p.distance, elevation:p.elevation}))
        route.hasGpx = false;
    }

    protected combineEpmWithEpp(route:RouteApiDetail, epp:DaumEpp) {
        if (!route?.points || route.points.length===0)
            return;
    
        let j=0;

        const prevInfo ={ distance:0, elevation:0, slope:0}
        
        // enrich points with elevation data from Epp
        for (let i=0;i<route.points.length;i++) {
            if (i===0) {
                route.points[i].elevation = epp.programData[j].elevation;
                prevInfo.elevation = route.points[i].elevation;
                prevInfo.slope = route.points[i].slope
            }
            else {
                j = this.getNextProgramIdx(j, epp, route.points[i]);                
                 
                if (j<epp.programData.length) {
                    this.copyEppElevationProfile(epp.programData[j], prevInfo, route.points, i);
                }
                else {
                    this.setFinalElevationProfile(prevInfo, route.points[i]);    
                }
            }
        }
    
        // enrich points with video speed data
        this.addVideoSpeed(route)
    }


    private getNextProgramIdx (j: number, epp: DaumEpp, point:RoutePoint)  {
        while (j < epp.programData.length && point.routeDistance > epp.programData[j].distance)
            j++;
        return j;
    }
    
    private copyEppElevationProfile(eppRecord: DaumEppProgramEntry,prevInfo, points: RoutePoint[], i: number) {
        const {distance: prevDistance, elevation: prevElevation} = prevInfo
        const distance = eppRecord.distance - prevDistance;
        const gain = eppRecord.elevation - prevElevation;

        if (distance !== 0) {
            const gainToPoint = gain / distance * (points[i].routeDistance - prevDistance);
            const distToPoint = points[i].routeDistance - prevDistance;
            points[i].elevation = prevElevation + gainToPoint;
            points[i - 1].slope = gainToPoint / distToPoint * 100;
        }
        else {
            points[i].elevation = prevElevation;
        }

        prevInfo.distance = points[i].routeDistance;
        prevInfo.elevation = points[i].elevation;    
        prevInfo.slope = points[i].slope;    

    }
    
    private setFinalElevationProfile( prevInfo, point: RoutePoint) { 
        const {distance: prevDistance, elevation: prevElevation, slope:prevSlope} = prevInfo

        point.slope = prevSlope;
        const distToPoint = point.routeDistance-prevDistance;
        const gainToPoint = prevSlope/100*distToPoint;
        point.elevation = prevElevation+gainToPoint;
    }

    private addVideoSpeed(route:RouteApiDetail) {
        let prevSpeed ;
        let prevTime ;
        let videoIdx = 0;

        route.points.forEach ( (p,idx) => {
            if (idx===0) {
                p.videoSpeed = route.video.mappings[0].videoSpeed;
                p.videoTime = route.video.mappings[0].time;
                prevSpeed = p.videoSpeed;
                prevTime = p.videoTime;
            }
            else {
                if (p.routeDistance<=route.video.mappings[videoIdx].distance) {
                    p.videoSpeed = prevSpeed;
                    p.videoTime = prevTime;
                }
    
                while (videoIdx<route.video.mappings.length && p.routeDistance>route.video.mappings[videoIdx].distance) 
                    videoIdx++;
                
                if (videoIdx<route.video.mappings.length) {
                    
                    p.videoSpeed = route.video.mappings[videoIdx].videoSpeed;
                    const v = p.videoSpeed/3.6;
    
                    p.videoTime = route.video.mappings[videoIdx].time - (route.video.mappings[videoIdx].distance-p.routeDistance)/v;
                    prevSpeed = p.videoSpeed;
                    prevTime = p.videoTime; 
                }
        
            }
    
        })
    }    

    
    protected parseEpp( data, route:RouteApiDetail ) {

        
        const json:JSONObject = {}
        const reader = new BinaryReader(data);

        json.header =reader.ReadString(8);
        //console.log(json.header)
        if (json.header!=='EW2_EUP ') {
            throw new Error('Invalid File Header');
        }

        json.version = reader.ReadUint32();
        if (json.version!==7 && json.version!==6)
            throw new Error ('Invalid File Version '+json.version);

        
        json.time =  reader.ReadUint64()
        json.name = reader.ReadString(64).trim();
        json.description = reader.ReadString(256).trim();
        json.programType = reader.ReadUint32(); 

        if (json.version===7)
            route.epp = this.getV7Program(reader,json);
        if (json.version===6)
            route.epp = this.getV6Program(reader,json);    
    
            
        if ( route.points===undefined || route.points.length===0) {
            this.createNoGpxRouteFromEpmEpp(route,route.epp)    
                    
        }
        else {
            this.combineEpmWithEpp(route,route.epp);
        }
 
    }

    protected async parseVideo(context: EpmParserContext): Promise<void> {

        await super.parseVideo(context)

        const eppData = await this.loadEpp(context)
        this.parseEpp(eppData,context.route)
        this.validate(context)
    }

    protected async buildInfo ( context:EpmParserContext):Promise<RouteInfo> { 
        const info = await super.buildInfo(context)
        if (context.noPositions)
            info.hasGpx = false
        return info
    }

    validate(context: EpmParserContext): void {
        super.validate(context)

        const {route} = context
        if (context.noPositions)
            route.gpxDisabled = true;
        
    }

}



