export const FP_PGMF = 1000 // Catalyst Program (.pgfm)
export const FP_RLV = 2000  // RLV (.rlv)
export const FP_CAF = 3000  // Catalyst workout (.caf)
export const FP_IMF = 4000  // VR workout (.imf)

export const LAP_DATA = 110;
export const NOTES = 120;
export const UNKNOWN = 130;
export const RIDER_INFO = 210;
export const GENERAL_INFO = 1010;
export const PROGRAM_DETAILS = 1020;
export const RLV_VIDEO_INFO = 2010;
export const RLV_FRAME_DISTANCE_MAPPING = 2020;
export const RLV_INFOBOX = 2030;
export const COURSE_INFO = 2040;
export const RIDE_INFO = 3010;
export const RIDE_DATA = 3020;
export const VR_GENERAL_INFO = 4010;
export const VR_COURSE_DATA = 4020;
export const VR_RIDE_INFO = 4030;
export const VR_RIDE_DATA = 4040;
export const RLV_MULTICOURSE_INFO = 6010;
export const RLV_ITEMMULTISECT = 6020;
export const TACX_RECORD_SIZE = 8

export const WATT_PROGRAM = 0
export const SLOPE_PROGRAM = 1
export const PULSE_PROGRAM = 2

export const TIME_PROGRAM = 0
export const DISTANCE_PROGRAM = 1


export type TacxFileType = 'pgmf' | 'rlv' | 'caf' | 'imf'
export type TacxBlockType = 'RLV Video info' | 'RLV Frame/Distance Mapping' | 'RLV InfoBox info' | 'Course info' | 'General Info' | 'Program'

export type TacxFile = {
    fileType : TacxFileType
    version: number
    blockCount: number

}

export interface RlvFile extends TacxFile {
    rlvInfo?: RlvInfo
    mapping?: RlvFrameDistanceMapping
    infoBoxes?: RlvInfoBoxInfo
    courseInfo?: RlvCourseInfo
}

export interface PgmfFile extends TacxFile { 
    generalInfo?: GeneralInfo
    program?: TacxProgram
}2

export type TacxBlock = {
    blockType : TacxBlockType
    version: number
    recordCount: number
    recordSize: number
}

export type RlvInfo = {
    videoFile: string
    framerate: number
    orgRunWeight: number
    frameOffset: number
}

export type FrameDistanceRecord = {
    frameNumber: number
    distancePerFrame: number
}

export type InfoBoxRecord = {
    frame: number,
    cmd: number
}

export type CourseInfoRecord = {
    start: number,
    end: number
    segmentName: string
    textFile: string
}

export type GeneralInfo = {
    checksum: number
    courseName: string
    wattSlopePulse: number;
    timeDist: number;
    totalTimeDist: number
    energyCons: number
    altitudeStart: number
    brakeCategory: number
}

export type ProgramRecord = {
    durationDistance: number
    pulse?: number
    slope?: number
    watts?: number
    rollingFriction: number
}


export type RlvFrameDistanceMapping  = Array<FrameDistanceRecord>
export type RlvInfoBoxInfo  = Array<InfoBoxRecord>
export type RlvCourseInfo  = Array<CourseInfoRecord>
export type TacxProgram = Array<ProgramRecord>
