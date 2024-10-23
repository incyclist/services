import { RlvCourseInfo, RlvFile, RlvFrameDistanceMapping, RlvInfoBoxInfo, TacxBlock } from "../../model/tacx"
import { TacxFileReader } from "./TacxReader"

// see https://web.archive.org/web/20111022163034/http://www.whitepeak.org/FortiusFile.aspx?file=.rlv

export class RLVFileReader extends TacxFileReader<RlvFile> {

    protected readHeader():void {
        super.readHeader()
        if (this.file.fileType !== 'rlv')
            throw new Error('Invalid file type');

    }

    protected readNextBlock():TacxBlock {

        const block:TacxBlock = super.readNextBlock()

        switch (block.blockType) {
            
            case 'RLV Video info': 
                this.readVideoInfo(block)
                break;
            case 'RLV Frame/Distance Mapping': 
                this.readFrameDistanceMapping(block)
                break;
            case 'RLV InfoBox info':
                this.readInfoBox(block)
                break;
            case 'Course info':
                this.readCourseInfo(block)
                break;
            default:
                throw new Error(`unsupported Block Type ${block.blockType} `);
                
        }
        return block
    }

    protected readVideoInfo(block: TacxBlock) {
        if (!this.file)
            throw new Error(`readVideoInfo must be called after parsing the Header`);
        if (this.file.rlvInfo)
            throw new Error(`Duplicate RLV Video info`);

        const videoFile = this.reader.ReadNetString(261)
        const framerate = this.reader.ReadFloat()
        const orgRunWeight = this.reader.ReadFloat()
        const frameOffset = this.reader.ReadInt32()

        this.file.rlvInfo = { videoFile,framerate,orgRunWeight,frameOffset  }

    }
    protected readFrameDistanceMapping(block: TacxBlock) {
        
        if (!this.file)
            throw new Error(`readFrameDistanceMapping must be called after parsing the Header`);
        if (this.file.mapping)
            throw new Error(`Duplicate Frame/Distance Mapping`);

        const mapping: RlvFrameDistanceMapping = []
        for (let i=0;i<block.recordCount;i++) {
            const frameNumber = this.reader.ReadUint32()
            const distancePerFrame = this.reader.ReadFloat()
            mapping.push({frameNumber,distancePerFrame})
        }
        this.file.mapping = mapping

    }

    protected readInfoBox(block: TacxBlock) {
        if (!this.file)
            throw new Error(`readInfoBox must be called after parsing the Header`);
        if (this.file.infoBoxes)
            throw new Error(`Duplicate Infobox`);

        const infoBoxes:RlvInfoBoxInfo = []
        for (let i=0;i<block.recordCount;i++) {
            const frame = this.reader.ReadUint32()
            const cmd = this.reader.ReadUint32()
            infoBoxes.push({frame,cmd})
        }
        this.file.infoBoxes = infoBoxes        
    }

    protected readCourseInfo(block: TacxBlock) {
        if (!this.file)
            throw new Error(`readCourseInfo must be called after parsing the Header`);
        if (this.file.courseInfo)
            throw new Error(`Duplicate CourseInfo`);

        const courseInfo:RlvCourseInfo = []
        for (let i=0;i<block.recordCount;i++) {
            const start = this.reader.ReadFloat()
            const end = this.reader.ReadFloat()
            const segmentName = this.reader.ReadNetString(33)
            const textFile = this.reader.ReadNetString(261)
            courseInfo.push({start,end,segmentName,textFile})
        }
        this.file.courseInfo = courseInfo
        
    }

}