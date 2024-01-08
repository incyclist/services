import { FileInfo, JSONObject, path } from "../../../api";
import { LocalizedText, RouteInfoText } from "../types";

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

    skip(cnt) {
        this.pos+=cnt;
    }

}

export const getReferencedFileInfo = (info:FileInfo, referenced:{ file?:string, url?:string}, scheme:string='file'):string=> {
    if (info.type!=='url') {
        if (referenced.file) {
            const fileName = info.filename.replace(info.name,referenced.file)
            return `file:///${fileName}`;
        }
        return referenced.url;
    }

    const target:{ file?:string, url?:string} = {}

    let fileName = referenced.file;

    if (referenced.url) {
        return referenced.url
    }

    
    if (fileName) {
        const inputUrl = info.url;

        const regex = /(\\|\/)/g;

        if (fileName.startsWith('http://') || fileName.startsWith('https://')) { 
            return fileName 
        }

        else if (fileName.search(regex)===-1) {
            
            if (  inputUrl.startsWith('incyclist:') || inputUrl.startsWith('file:')) {
                const parts = inputUrl.split('://');
                const targetPath = parts[1].replace(info.name,fileName)
                return  `${scheme}://${targetPath}`
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
                target.url = `${scheme}:///${fileName}`;                                            
            }
            return target.url
        }

    }

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