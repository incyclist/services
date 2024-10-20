import { PgmfFile, ProgramRecord, TacxBlock, TacxProgram, WATT_PROGRAM, PULSE_PROGRAM, SLOPE_PROGRAM } from "../../model/tacx"
import { TacxFileReader } from "./TacxReader";


// see https://web.archive.org/web/20111022163034/http://www.whitepeak.org/FortiusFile.aspx?file=.pgmf

export class PGMFFileReader extends TacxFileReader<PgmfFile> {
    

    protected readHeader():void {
        super.readHeader()
        if (this.file.fileType !== 'pgmf')
            throw new Error('Invalid file type');

    }

    /**
     * Reads the next block of data from the file
     * 
     * @returns a `TacxBlock` object with the block type and data
     * @throws {Error} if an unsupported block type is encountered
     * @protected
     */
    protected readNextBlock():TacxBlock {

        const block:TacxBlock = super.readNextBlock()

        switch (block.blockType) {
            
            case 'General Info':
                this.readGeneralInfo(block)
                break;
            case 'Program': 
                this.readProgram(block)
                break;
            default:
                throw new Error(`unsupported Block Type ${block.blockType} `);
                
        }
        return block
    }

    /**
     * Read the General Info block ( https://web.archive.org/web/20111022163034/http://www.whitepeak.org/FortiusBlock.aspx?block=1010)
     * 
     * @param block the block to reaslowerd
     * @throws {Error} if called before reading the header
     * @throws {Error} if called twice
     * @private
     */
    protected readGeneralInfo(block: TacxBlock) {
        if (!this.file)
            throw new Error(`readGeneralInfo must be called after parsing the Header`);
        if (this.file.generalInfo)
            throw new Error(`Duplicate General info`);

        const checksum = this.reader.ReadUint32()        
        const courseName = this.reader.ReadNetString(17)
        const wattSlopePulse = this.reader.ReadInt32()
        const timeDist = this.reader.ReadInt32()
        const totalTimeDist = this.reader.ReadDouble()
        const energyCons = this.reader.ReadDouble()
        const altitudeStart = this.reader.ReadFloat()
        const brakeCategory = this.reader.ReadInt32()


        this.file.generalInfo = { checksum,courseName,wattSlopePulse,timeDist,totalTimeDist,energyCons,altitudeStart,brakeCategory }

    }
    
    /**
     * Read the program block (https://web.archive.org/web/20100323220842/http://www.whitepeak.org/FortiusBlock.aspx?block=1020)
     * 
     * @param block the block to read
     * @throws {Error} if called before reading the header
     * @throws {Error} if called twice
     * @private
     */
    protected readProgram(block: TacxBlock) {
        if (!this.file)
            throw new Error(`readProgram must be called after parsing the Header`);
        if (this.file.program)
            throw new Error(`Duplicate Program`);

        const program: TacxProgram = []
        for (let i=0;i<block.recordCount;i++) {
            const durationDistance = this.reader.ReadFloat()
            const pulseSlopeWatts = this.reader.ReadFloat()
            const rollingFriction = this.reader.ReadFloat()

            const record:ProgramRecord = {durationDistance,rollingFriction}
            switch (this.file.generalInfo.wattSlopePulse) {
                case WATT_PROGRAM: record.watts = pulseSlopeWatts; break;
                case SLOPE_PROGRAM: record.slope = pulseSlopeWatts; break;
                case PULSE_PROGRAM: 
                default:
                    record.pulse = pulseSlopeWatts; break;

            }

            program.push(record)
        }
        this.file.program = program
    }
}