import { FileInfo,  getBindings} from "../../../api";
import { LocalizedText, RouteInfoText } from "../types";
import { JSONObject } from "../../../utils/xml";

export class BinaryReader {
    protected pos:number
    protected buffer:Buffer

    constructor (data) {
        this.pos =0;
        
        this.buffer = Buffer.from(data)
    }


    get length() {
        return this.buffer.length
    }
    
    setPosition(pos) {
        this.pos = pos;
    }

    ReadUint32() {
        const val = this.buffer.readUInt32LE(this.pos)
        this.pos +=4
        return val;
    }
    
    ReadUint64() {
        const high = this.ReadUint32()
        const low = this.ReadUint32()

        return (high << 32) +low;
    }

    ReadUint16() {
        const val = this.buffer.readUInt16LE(this.pos)
        this.pos +=2
        return val;
    }

    ReadFloat() {
        const val = this.buffer.readFloatLE(this.pos)
        this.pos +=4
        return val;
    }

    ReadDouble() {
        const val = this.buffer.readDoubleLE(this.pos)
        this.pos +=8
        return val;
    }

    ReadInt32() {
        return this.ReadUint32();
    }

    ReadString(cnt:number) {
        const part = Buffer.from(this.buffer.subarray(this.pos,this.pos+cnt))
        this.pos+=cnt

        const str=part.toString('ascii')
        const end = str.indexOf( '\x00' )
        if (end!==-1)
            return str.substring(0,end)
        return str
    }

    ReadNetString(cnt:number) {
        const part = Buffer.from(this.buffer.subarray(this.pos,this.pos+cnt*2))
        this.pos+=cnt*2

        let str=''
        let i = 0
        while (i<cnt) {
            const c = part.readUInt16LE(i*2)
            if (c===0) 
                return str
            str+=String.fromCharCode(c)
            i++
        }
        return str
    }

    skip(cnt) {
        this.pos+=cnt;
    }

}

export const getReferencedFileInfo = (info:FileInfo, referenced:{ file?:string, url?:string}, scheme:string='file'):string=> {

    // Do we check against a local file ? 
    if (info.type!=='url') {
        return buildFromFile(info,referenced, scheme)
    }


    // if the target is a URL, just return that
    if (referenced.url) {
        return referenced.url
    }

    if (!referenced.file) {
        // Target is neither defined as file or URL -> should never happen: throw an Exception
        throw new Error('referenced.file or referenced.url must be specified')
    }
    
    let targetFileName = referenced.file;
    //const regex = /(\\|\/)/g;
    const regex = /([\\\/])/g;

    if (targetFileName.startsWith('http://') || targetFileName.startsWith('https://')) { 
        return targetFileName 
    }
    else if (targetFileName.search(regex)===-1) {
        return buildAbsolutePathTarget(targetFileName,info,scheme)

    }
    else if (targetFileName.startsWith('.')) {
        return buildRelativePathTarget(targetFileName,info,scheme)
    }
    else {
        return `${scheme}:///${targetFileName}`
    }
}

const buildFromFile = (info:FileInfo, referenced:{ file?:string, url?:string}, scheme:string='file') => { 
    if (referenced.file) {
        const fileName = info.filename.replace(info.name,referenced.file)
        return `file:///${fileName}`;
    }
    return referenced.url;

}

const buildAbsolutePathTarget = (fileName: string, info: FileInfo, scheme: string) => { 
    const inputUrl = info.url;

    if (  inputUrl.startsWith('incyclist:') || inputUrl.startsWith('file:')) {
        const target:{ file?:string, url?:string} = {}
        const parts = inputUrl.split('://');
        const targetPath = parts[1].replace(info.name,fileName)
        return  `${scheme}://${targetPath}`
    }

}

const buildRelativePathTarget = (fileName: string, info: FileInfo, scheme: string) => {
    const target:{ file?:string, url?:string} = {}
    
    const path = getBindings().path;
    //videoFile = joinPath( info.dir, videoFile, delimiter)
    fileName = path.join(info.dir, fileName);
    target.file = fileName;
    target.url = `${scheme}:///${fileName}`;

    return target.url;
}


export const parseInformations =( informations?:Array<JSONObject>):Array<RouteInfoText> =>{
    if (!informations || !Array.isArray(informations))
        return;

    return informations.map( i=> {
        
        const distance = Number(i['distance'])
        delete i['distance']

        const localizedText = i as LocalizedText
        const keys = Object.keys(i)
        const text = i[ keys[0]] as string
        return {distance,localizedText,text}

    })

}

