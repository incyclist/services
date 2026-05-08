import { FileInfo,  getBindings} from "../../../api";
import { RouteInfoText } from "../types";
import { JSONObject } from "../../../utils/xml";
import { LocalizedText } from "../../../i18n";

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
            str+=String.fromCodePoint(c)
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
        return buildUrlFromFile(info,referenced)
    }


    // if the target is a URL, just return that
    if (referenced.url) {
        return referenced.url
    }

    if (!referenced.file) {
        // Target is neither defined as file or URL 
        // -> no need to build a target path
        return
    }

    if (referenced.file && info.filename?.startsWith('content://')) {
        return `${info.dir}${info.delimiter}${referenced.file}`
    }

    // Determine effective scheme: use passed scheme parameter, unless it's default 'file' and input URL has a different scheme
    let effectiveScheme = scheme;
    if (scheme === 'file' && info.url) {
        // Only extract scheme from URL if using default scheme (to preserve schemes like 'incyclist://')
        const schemeMatch = info.url.match(/^([a-z]+):/);
        if (schemeMatch && schemeMatch[1] !== 'file') {
            effectiveScheme = schemeMatch[1];
        }
    }

    const targetFileName = referenced.file;
    const regex = /([\\/])/g;

    if (targetFileName.startsWith('http://') || targetFileName.startsWith('https://')) {
        return targetFileName
    }
    else if (targetFileName.search(regex)===-1) {
        return buildAbsolutePathTarget(targetFileName,info,effectiveScheme)

    }
    else if (targetFileName.startsWith('.')) {
        return buildRelativePathTarget(targetFileName,info,effectiveScheme)
    }
    else {
        return `${effectiveScheme}:///${targetFileName}`
    }
}

const isAbsolutePath = (path: string): boolean => {
    if (!path) return false;
    // Unix absolute path
    if (path.startsWith('/')) return true;
    // Windows absolute path (C:\ or C:/)
    if (/^[A-Za-z]:[/\\]/.test(path)) return true;
    return false;
}

const buildUrlFromFile = (info:FileInfo, referenced:{ file?:string, url?:string}) => {
    // URL takes precedence over file
    if (referenced.url) {
        return referenced.url;
    }

    if (referenced.file) {
        if (info.filename?.startsWith('content://')) {
            return `${info.dir}${info.delimiter}${referenced.file}`
        }

        const fileName = info.filename?.replace(info.base, referenced.file)

        if (fileName.startsWith('file://')) {
            let cleanPath = fileName;
            try {
                // Try to decode in case it's already encoded
                cleanPath = decodeURIComponent(fileName.replace(/^file:\/\/\/?/, ''));
            } catch  {
                // If decoding fails (malformed %), use the filename as-is
                cleanPath = fileName.replace(/^file:\/\/\/?/, '');
            }
            return `file://${encodeURI(cleanPath)}`;
        }

        let cleanPath = fileName;
        try {
            // Try to decode in case it's already encoded
            cleanPath = decodeURIComponent(fileName);
        } catch  {
            /* we use the original filename*/
        }

        // Note: Path normalization (./ and ../) is not performed at this stage
        // Paths are returned as-is to preserve the original reference format
        const normalizedPath = cleanPath;

        // Always return a URL with file:// scheme
        if (isAbsolutePath(normalizedPath)) {
            // For absolute paths, use proper file:// URL syntax
            // Unix paths: file:// + /path = file:///path
            // Windows paths: file:// + / + C:/path = file:///C:/path
            if (normalizedPath.match(/^[A-Za-z]:/)) {
                // Windows drive letter path needs an extra slash
                return `file:///${encodeURI(normalizedPath)}`;
            } else {
                // Unix absolute path already starts with /
                return `file://${encodeURI(normalizedPath)}`;
            }
        } else {
            // For relative paths (e.g., ./__tests__/data/file.gpx), use file:// + relative path
            return `file://${encodeURI(normalizedPath)}`;
        }
    }
    return undefined;

}

const buildAbsolutePathTarget = (fileName: string, info: FileInfo, scheme: string) => {
    const inputUrl = info.url;

    if (inputUrl.startsWith('incyclist:') || inputUrl.startsWith('file:')) {
        const parts = inputUrl.split('://');
        const targetPath = parts[1].replace(info.base, fileName)
        // Proper file URL syntax: scheme + :// + path (path already starts with /)
        return `${scheme}://${targetPath}`
    }

}

const buildRelativePathTarget = (fileName: string, info: FileInfo, scheme: string) => {
    const target: { file?: string, url?: string } = {}

    const path = getBindings().path;
    fileName = path.join(info.dir, fileName);
    target.file = fileName;

    // If the result is still a relative path (e.g., ./__tests__/...), return as-is
    // Only use file:// URL scheme if path is absolute
    if (isAbsolutePath(fileName)) {
        // Use proper file URL syntax: scheme + :// + path (path already starts with /)
        target.url = `${scheme}://${fileName}`;
    } else {
        // Return relative path without file:// scheme
        target.url = fileName;
    }

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

export const fixIncorrectFileInfo = (file:Partial<FileInfo>) => {
    if (!file.base) {
        file.base = file.name
        file.name = file.base.replace( `.${file.ext}`, '')
    }

    if (!file.filename && file.url) {
        file.filename = file.url.replace('file://','')
    }
    if (!file.filename && file.dir && file.base) {
        file.filename = `file://${file.dir}/${file.base}`
    }

    if (!file.type) {
        file.type = file.url?.startsWith('http') ? 'url' : 'file'
    }
}

const decodeUtf16Be = (data: Buffer): string => {
    const swapped = Buffer.alloc(data.length);
    for (let i = 0; i + 1 < data.length; i += 2) {
        swapped[i] = data[i + 1];
        swapped[i + 1] = data[i];
    }
    return Buffer.from(swapped.toString('utf16le')).toString('utf-8');
};

export const getUtf8Data = (res: string | Buffer): string => {
    // Use 'binary' so each char maps 1:1 to a byte, allowing BOM detection
    // regardless of whether res was already decoded as a string or not.
    const buf = Buffer.isBuffer(res) ? res : Buffer.from(res, 'binary');

    // UTF-16 BE BOM: FE FF
    if (buf[0] === 0xFE && buf[1] === 0xFF) {
        return decodeUtf16Be(buf.subarray(2));
    }

    // UTF-16 LE BOM: FF FE
    if (buf[0] === 0xFF && buf[1] === 0xFE) {
        return Buffer.from(buf.subarray(2).toString('utf16le')).toString('utf-8');
    }

    // Mangled BOM: FE FF or FF FE bytes were decoded as UTF-8 replacement chars (U+FFFD)
    // and re-encoded via 'binary', producing 0xFD 0xFD. Distinguish BE vs LE by null-byte position.
    if (buf[0] === 0xFD && buf[1] === 0xFD) {
        if (buf[2] === 0x00 && buf[3] === 0x3C) { // UTF-16 BE: <?
            return decodeUtf16Be(buf.subarray(2));
        }
        if (buf[2] === 0x3C && buf[3] === 0x00) { // UTF-16 LE: <?
            return Buffer.from(buf.subarray(2).toString('utf16le')).toString('utf-8');
        }
    }

    // No UTF-16 BOM — treat as UTF-8, stripping the optional UTF-8 BOM.
    // Two cases:
    //   - string properly decoded as UTF-8: BOM appears as single U+FEFF codepoint
    //   - string decoded as binary/latin1: BOM appears as three raw bytes EF BB BF
    const str = typeof res === 'string' ? res : buf.toString('utf-8');
    if (str.charCodeAt(0) === 0xFEFF) return str.slice(1);
    if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return buf.subarray(3).toString('utf-8');
    return str;
    
}
