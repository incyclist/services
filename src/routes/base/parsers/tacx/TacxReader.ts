import { COURSE_INFO, FP_CAF, FP_IMF, FP_PGMF, FP_RLV, GENERAL_INFO, PROGRAM_DETAILS, RLV_FRAME_DISTANCE_MAPPING, RLV_INFOBOX, RLV_VIDEO_INFO, TacxBlock, TacxBlockType, TacxFile, TacxFileType } from "../../model/tacx"
import { BinaryReader } from "../utils"

export class TacxFileReader<X extends TacxFile> {
    

    protected file: X
    protected reader: BinaryReader

    static isValid(data: ArrayBuffer): boolean {
        try {
            const buffer = Buffer.from(data)
            const reader = new BinaryReader(buffer)

            const fp = reader.ReadUint16()
            this.parseFileType(fp)
            return true;
        }
        catch {
            return false
        }
    }
    /**
     * Parses the content of the Tacx file (rlv,pgmf,...) and returns a TacxFile object. 
     * The binary content is expected to be in ArrayBuffer format
     * 
     * @param data the data to parse
     * @returns the parsed TacxFile
     */
    parse( data: ArrayBuffer): X {
        const buffer = Buffer.from(data)
        this.reader = new BinaryReader(buffer)

        this.readHeader()        
        for (let i = 0; i < this.file.blockCount; i++) {
            this.readNextBlock()
        }

        return this.file        
    }

    protected readHeader():void {

        const fp = this.reader.ReadUint16()
        const fileType = TacxFileReader.parseFileType(fp)

        const version = this.reader.ReadUint16()
        const blockCount = this.reader.ReadUint32()

        this.file = {
            fileType,
            version,
            blockCount
        } as X
    }

    protected readNextBlock():TacxBlock {
        const bt = this.reader.ReadUint16()        
        const blockType = TacxFileReader.parseBlockType(bt)        
        const version = this.reader.ReadUint16()
        const recordCount = this.reader.ReadUint32()
        const recordSize = this.reader.ReadUint32()

        const block:TacxBlock = { blockType, version, recordCount, recordSize }
        return block
    }


    protected static parseFileType(fp: number):TacxFileType { 
        switch (fp) {
            case FP_PGMF:
                return 'pgmf';
            case FP_RLV:
                return 'rlv';
            case FP_CAF:
                return 'caf';
            case FP_IMF:
                return 'imf';
            default:
                throw new Error(`Unknown file type: ${fp}`);
        }
    }

    protected static parseBlockType(bt: number):TacxBlockType {
        
    
        switch (bt) {
            case RLV_VIDEO_INFO:
                return 'RLV Video info';
            case RLV_FRAME_DISTANCE_MAPPING:
                return 'RLV Frame/Distance Mapping';
            case RLV_INFOBOX:
                return 'RLV InfoBox info';
            case COURSE_INFO:
                return 'Course info';
            case GENERAL_INFO:
                return 'General Info'
            case PROGRAM_DETAILS:
                return 'Program'
            default:
                throw new Error(`Unknown block type: ${bt}`);
        }
    }

}