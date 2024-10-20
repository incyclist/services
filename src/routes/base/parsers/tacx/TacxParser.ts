import { FileInfo, getBindings } from "../../../../api";
import clone from "../../../../utils/clone";
import { RouteApiDetail } from "../../api/types";
import { DISTANCE_PROGRAM, PgmfFile, RlvCourseInfo, RlvFile, SLOPE_PROGRAM } from "../../model/tacx";
import { Parser, ParseResult, RouteInfo, RoutePoint, VideoMapping } from "../../types";
import { getRouteHash, validateRoute } from "../../utils/route";
import { PGMFFileReader } from "./pgmf";
import { RLVFileReader } from "./rlv";
import { TacxFileReader } from "./TacxReader";

export interface TacxParserContext {
    rlvFile: FileInfo
    pgmfFile: FileInfo
    route?: RouteApiDetail       
    rlvData?:RlvFile
    pgmfData?:PgmfFile
}

export class TacxParser implements Parser<ArrayBuffer,RouteApiDetail> {


    async import(file: FileInfo, data?: ArrayBuffer): Promise<ParseResult<RouteApiDetail>> {
        const context = this.buildContext(file)
        
        await this.parseRlv(context)
        await this.parsePgmf(context)

        return this.buildResult(context)
    }

    async getData(info: FileInfo, data?: ArrayBuffer): Promise<ArrayBuffer> {
        const {loader,fs} = getBindings()
        info.encoding = 'binary'

        const res = await loader.open(info)
        if (res.error) {
            throw new Error(`Could not open ${info.ext} File`)
        }
        return res.data  as ArrayBuffer
    }

    supportsContent(data: ArrayBuffer): boolean {
        return TacxFileReader.isValid(data)
    }

    protected buildContext(file: FileInfo): TacxParserContext {

        const {dir,delimiter: d,name} = file

        if (file.ext === 'rlv') {
            const pgmfFile = clone(file)
            pgmfFile.ext = 'pgmf'     
            pgmfFile.name = pgmfFile.name.replace('.rlv','.pgmf')      
            pgmfFile.filename = `${dir}${d}${pgmfFile.name}`
            pgmfFile.url = `file:///${dir}${d}${pgmfFile.name}`

            return {
                rlvFile: file,
                pgmfFile
            }                
        }
        else if (file.ext === 'pgmf') {
            const rlvFile = clone(file)
            rlvFile.ext = 'rlv'
            rlvFile.name = rlvFile.name.replace('.pgmf','.rlv')      
            rlvFile.filename = `${dir}${d}${rlvFile.name}`
            rlvFile.url = `file:///${dir}${d}${rlvFile.name}`
            return {
                rlvFile,
                pgmfFile: file
            }
        }
        else {
            throw new Error(`Unsupported file type ${file.ext}`)
        }
    }

    


    protected async parseRlv(context: TacxParserContext): Promise<void> {
        const data = await this.getData(context.rlvFile)

        const reader = new RLVFileReader()
        context.rlvData = reader.parse(data)
    }

    protected async parsePgmf(context: TacxParserContext): Promise<void> {
        const data = await this.getData(context.pgmfFile)

        const reader = new PGMFFileReader()
        context.pgmfData = reader.parse(data)        
    }

    protected getCountryPrefix(title?:string):string|undefined {
        if (!title)
            return

        if (title.match(/^[A-z]{2}[-_]{1}.*/g)) {            
            return title.substring(0,2)
        }
    }


    protected buildResult(context: TacxParserContext): ParseResult<RouteApiDetail> { 

        if (!context.rlvData || !context.pgmfData) {
            throw new Error(`Could not parse ${context.pgmfFile.name} or ${context.rlvFile.name}`)
        }

        if (context.pgmfData.generalInfo?.wattSlopePulse!==SLOPE_PROGRAM) {
            throw new Error(`File does not contain slope information`)
        }
        if (context.pgmfData.generalInfo?.timeDist!==DISTANCE_PROGRAM) {
            throw new Error(`File does not contain distance information`)
        }


        const data: RouteInfo = this.buildGeneralInfo(context);
        this.buildVideoFileInfo(context, data); 
        this.buildTrackInfo(context, data);
        this.buildSegments(context.rlvData.courseInfo,data)       

        const {title,originalName,localizedTitle,country,distance,elevation,points,videoUrl, videoFormat} =data

        const route:RouteApiDetail = { id:title, title,originalName,localizedTitle,country,distance,elevation,
                                       points, gpxDisabled:true, 
                                       video: {url:videoUrl,file:undefined,format:videoFormat,mappings:[],framerate:25,selectableSegments:undefined} }

        const routeHash = getRouteHash(route)
        route.id = data.id = routeHash
        route.routeHash = data.routeHash = routeHash
        context.route = route        

        validateRoute(route)

        this.addVideoInformation(context,data)
        
        return {
            data,
            details: route
        }
    }
    

    protected buildGeneralInfo(context: TacxParserContext) {
        const data: RouteInfo = {
            hasGpx: false,
            hasVideo: context.rlvData !== undefined,
            isLoop: false,
            category: 'Imported',
            isLocal: true,
            isDemo: false,
            requiresDownload: false,
            tsImported: Date.now(),
            originalName: context.pgmfData?.generalInfo?.courseName,
            title: context.pgmfData?.generalInfo?.courseName
        };

        let country;
        const countryPrefix = this.getCountryPrefix(data.title);
        if (countryPrefix) {
            data.title = data.title.substring(3);
            data.country = countryPrefix.toUpperCase();
            data.localizedTitle = { en: data.title };
        }
        return data;
    }

    protected buildTrackInfo(context: TacxParserContext, data: RouteInfo):RoutePoint[] {
        const points:RoutePoint[] = [];
        let distance = 0;
        let elevation = context.pgmfData.generalInfo?.altitudeStart;

        let pElevation = elevation;
        let pDistance = distance;
        let totalElevation = 0;

        context.pgmfData.program.forEach(p => {
            distance += p.durationDistance;
            const slope = p.slope;
            const gain = slope * p.durationDistance / 100;
            elevation += gain;
            if (gain > 0)
                totalElevation += gain;


            points.push({ routeDistance: pDistance, elevation: pElevation, slope, lat:undefined, lng:undefined });
            pElevation = elevation;
            pDistance = distance;
        });

        const minElevation = Math.min(...points.map(p=>p.elevation))
        if (minElevation < 0) {
            points.forEach(p=>{
                p.elevation -= minElevation;
            })
        }

        data.elevation = totalElevation;
        data.distance = distance;
        data.points = points

        return points
    }

    protected buildVideoFileInfo(context: TacxParserContext, data: RouteInfo ) {
        const fileName = context.rlvData.rlvInfo.videoFile
        if (!fileName) 
            return

        const {path,fs} = getBindings()

        const file = path.parse(fileName);
        data.videoFormat = file.ext.split('.').pop().toLowerCase();

        const winFile = file.name.split('\\');
        const uxFile = file.name.split('/');

        let name;
        let isRelative = false;
        if (winFile.length > 1) {
            name = fileName.split('\\').pop();
            isRelative = true;
        }
        else if (uxFile.length > 1) {
            name = fileName.split('/').pop();
            isRelative = true;
        }
        else {
            name = `${file.base}`;

        }



        const exists = fs.existsSync(fileName);
        data.videoUrl = exists ? `video:///${fileName}` : `video:///${path.join(context.pgmfFile.dir, name)}`;
    }

    protected buildSegments(courseInfo:RlvCourseInfo, data: RouteInfo) { 
        if (!courseInfo)
            return;

        data.segments = []
        courseInfo.forEach( s => {
            data.segments.push({
                name: s.segmentName,
                start: Math.round(s.start),
                end: Math.round(s.end)
            })
            
        })
    }

    protected addVideoInformation(context: TacxParserContext,data: RouteInfo) {
        
    
        const route = context.route;

        if (!route)
            return

        const framerate = context.rlvData.rlvInfo.framerate
        
        const mappings:VideoMapping[] = []
        let speed = 0;
        let time = 0;
        let distance =0
        let frame = 0

        context.rlvData?.mapping.forEach( (m,idx) => {
            if (idx===0) {
                
                speed = m.distancePerFrame*framerate
                mappings.push({
                    time,
                    videoSpeed:speed*3.6,
                    distance: 0,
                    frame: 0
                })

                distance += (m.distancePerFrame*m.frameNumber)
                time += m.frameNumber/framerate
            }
            else {
                const frames = m.frameNumber-frame
                const t = frames/framerate
                const s = speed*t

                distance += s;
                time += t
                
                if (frames>1) {
                    mappings.push({
                        time, 
                        videoSpeed:speed*3.6,  
                        distance:Math.round(distance), 
                        frame:m.frameNumber
                    })
                }

            }

            speed = m.distancePerFrame*framerate
            frame = m.frameNumber

            
        })

        route.video = {
            file:data.videoUrl,
            format: data.videoFormat,
            url:undefined,
            framerate,
            mappings,
            selectableSegments:data.segments
        }



    }

    supportsExtension(extension: string): boolean {
        return (extension.toLowerCase() === 'pgmf' || extension.toLowerCase() === 'rlv');
    }
}