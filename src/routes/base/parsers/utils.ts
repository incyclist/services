import { FileInfo, path } from "../../../api";
import { RoutePoint, VideoRoutePoint } from "../types";

export const addVideoSpeed = (points:Array<RoutePoint>,video):Array<VideoRoutePoint> => {
    let prevSpeed ;
    let prevTime ;
    let videoIdx = 0;

    return points.map ( (point,idx) => {

        const p:VideoRoutePoint = {...point, videoSpeed:undefined, videoTime:undefined}

        if (idx===0) {
            p.videoSpeed = video.mappings[0].videoSpeed;
            p.videoTime = video.mappings[0].time;
            prevSpeed = p.videoSpeed;
            prevTime = p.videoTime;
        }
        else {
            if (p.routeDistance<=video.mappings[videoIdx]) {
                p.videoSpeed = prevSpeed;
                p.videoTime = prevTime;
            }

            while (videoIdx<video.mappings.length && p.routeDistance>video.mappings[videoIdx].distance) 
                videoIdx++;
            
            if (videoIdx<video.mappings.length) {
                
                p.videoSpeed = video.mappings[videoIdx].videoSpeed;
                const v = p.videoSpeed/3.6;

                p.videoTime = video.mappings[videoIdx].time - (video.mappings[videoIdx].distance-p.routeDistance)/v;
                prevSpeed = p.videoSpeed;
                prevTime = p.videoTime; 
            }
    
        }
        return p;

    })
}


export const getReferencedFileInfo = (info:FileInfo, referenced:{ file?:string, url?:string}, scheme:string='file')=> {
    if (info.type!=='url')
        return;

    const target:{ file?:string, url?:string} = {}

    let fileName = referenced.file;

    if (referenced.url) {
        return {url:referenced.url}
    }

    
    if (fileName) {
        const inputUrl = info.url;

        const regex = /(\\|\/)/g;

        if (fileName.startsWith('http://') || fileName.startsWith('https://')) { 
            return {url: fileName};            
        }

        else if (fileName.search(regex)===-1) {
            
            if (  inputUrl.startsWith('incyclist:') || inputUrl.startsWith('file:')) {
                const parts = inputUrl.split('://');
                const targetPath = parts[1].replace(info.name,fileName)
                return{url: `${scheme}://${targetPath}`}
            }

        }
        else {
            // relative path
            if ( fileName.startsWith('.') ) {
                //videoFile = joinPath( info.dir, videoFile, delimiter)
                fileName = path.join( info.dir, fileName)
                target.file = fileName
                target.url = `${scheme}:///${fileName}`;
            }
            else {
                referenced.url = `${scheme}:///${fileName}`;                                            
            }
        }
    }

}