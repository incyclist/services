import { COURSE_INFO, FP_CAF, FP_IMF, FP_PGMF, FP_RLV, GENERAL_INFO, PROGRAM_DETAILS, RLV_FRAME_DISTANCE_MAPPING, RLV_INFOBOX, RLV_VIDEO_INFO, TacxBlock, TacxBlockType, TacxFile, TacxFileType } from "../../model/tacx"
import { BinaryReader } from "../utils"

/**
 * Base reader for Tacx binary files (RLV, PGMF, CAF, IMF formats).
 *
 * Provides core functionality to validate and parse Tacx file headers and block structures.
 * Subclasses like RLVFileReader and PGMFFileReader extend this to handle format-specific
 * block processing.
 *
 * @template X - The specific Tacx file type being parsed (RlvFile, PgmfFile, etc.)
 */
export class TacxFileReader<X extends TacxFile> {


    protected file: X
    protected reader: BinaryReader

    /**
     * Validates if the provided data is a valid Tacx file format.
     *
     * Checks the file header to ensure the data starts with a valid Tacx file type identifier.
     *
     * @param data - Binary file data to validate
     * @returns True if data is a valid Tacx file, false otherwise
     */
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
     * Parses a Tacx file and returns a structured file object.
     *
     * Reads the file header to extract metadata (file type, version, block count),
     * then iterates through all blocks for subclass processing.
     *
     * @param data - Binary file data as ArrayBuffer
     * @returns Parsed file object with metadata and block data
     * @throws Error if file format is invalid or unsupported
     */
    parse(data: ArrayBuffer): X {
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