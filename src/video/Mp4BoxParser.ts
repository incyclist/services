export type CodecDetails = {
    profile?: string
    profileId?: number
    tier?: string
    level?: string
    chromaFormat?: string
    bitDepthLuma?: number
    bitDepthChroma?: number
    monochrome?: boolean
}

export type Mp4CodecInfo = {
    containerBrand?: string
    videoCodec?: string
    audioCodec?: string
    width?: number
    height?: number
    moovLocation?: 'head' | 'tail' | 'not-found'
    incomplete?: boolean
    codecDetails?: CodecDetails
}

type Box = {
    type: string
    start: number
    size: number
    headerSize: number
    bodyStart: number
    bodyEnd: number
}

const readBoxHeader = (buf: Buffer, offset: number): Box | undefined => {
    if (offset + 8 > buf.length)
        return undefined

    const size32 = buf.readUInt32BE(offset)
    const type = buf.toString('ascii', offset + 4, offset + 8)

    let headerSize = 8
    let size = size32

    if (size32 === 1) {
        // 64-bit extended size
        if (offset + 16 > buf.length)
            return undefined
        const high = buf.readUInt32BE(offset + 8)
        const low = buf.readUInt32BE(offset + 12)
        size = high * 2 ** 32 + low
        headerSize = 16
    }
    else if (size32 === 0) {
        // box extends to end of buffer - only meaningful for a complete file, treat as unknown here
        size = buf.length - offset
    }

    return { type, start: offset, size, headerSize, bodyStart: offset + headerSize, bodyEnd: offset + size }
}

const findBoxes = (buf: Buffer, start: number, end: number): Box[] => {
    const boxes: Box[] = []
    let offset = start

    while (offset < end) {
        const box = readBoxHeader(buf, offset)
        if (!box || box.size <= 0 || box.bodyEnd > end)
            break
        boxes.push(box)
        offset = box.bodyEnd
    }
    return boxes
}

const findBox = (boxes: Box[], type: string): Box | undefined => boxes.find(b => b.type === type)

/**
 * The tail chunk we read is "last N bytes of the file", which almost never starts at a box
 * boundary (it typically starts partway through the preceding mdat's raw sample data). So,
 * unlike the head chunk (which legitimately starts at file offset 0, a real box boundary),
 * we can't sequentially walk boxes from offset 0 here - we search for the 4-byte 'moov'
 * signature directly and validate the box header found 4 bytes before it.
 */
const findMoovBySignature = (buf: Buffer): Box | undefined => {
    const signature = Buffer.from('moov', 'ascii')
    let searchFrom = 0

    while (searchFrom < buf.length) {
        const typeOffset = buf.indexOf(signature, searchFrom)
        if (typeOffset === -1 || typeOffset < 4)
            return undefined

        const box = readBoxHeader(buf, typeOffset - 4)
        if (box?.type === 'moov' && box.bodyEnd <= buf.length)
            return box

        searchFrom = typeOffset + 4
    }
    return undefined
}

const parseFtyp = (buf: Buffer, box: Box): string | undefined => {
    if (box.bodyStart + 4 > buf.length)
        return undefined
    return buf.toString('ascii', box.bodyStart, box.bodyStart + 4)
}

const parseHandlerType = (buf: Buffer, hdlrBox: Box): string | undefined => {
    // hdlr body: version(1)+flags(3)+pre_defined(4)+handler_type(4)+reserved(12)+name
    const offset = hdlrBox.bodyStart + 8
    if (offset + 4 > buf.length)
        return undefined
    return buf.toString('ascii', offset, offset + 4)
}

const parseStsdCodec = (buf: Buffer, stsdBox: Box): string | undefined => {
    // stsd body: version(1)+flags(3)+entry_count(4), then first sample entry: size(4)+format(4)
    const entryOffset = stsdBox.bodyStart + 8
    if (entryOffset + 8 > buf.length)
        return undefined
    return buf.toString('ascii', entryOffset + 4, entryOffset + 8)
}

const CHROMA_FORMAT_NAMES: Record<number, string> = {
    0: '4:0:0 (monochrome)', 1: '4:2:0', 2: '4:2:2', 3: '4:4:4'
}

/**
 * The codec config box (avcC/hvcC/av1C) is a child box nested inside the first sample entry
 * in stsd, not a sibling of it - it sits after the VisualSampleEntry's fixed 86-byte header
 * (SampleEntry base 8 + reserved/data_reference_index 8 + pre_defined/reserved/pre_defined 16
 * + width/height 4 + h/v resolution 8 + reserved 4 + frame_count 2 + compressorname 32 +
 * depth 2 + pre_defined 2 = 78, plus the entry's own size+format header 8 = 86), per
 * ISO/IEC 14496-12's VisualSampleEntry layout.
 */
const findSampleEntryChildBoxes = (buf: Buffer, stsdBox: Box): Box[] => {
    const entryOffset = stsdBox.bodyStart + 8
    if (entryOffset + 4 > buf.length)
        return []

    const entrySize = buf.readUInt32BE(entryOffset)
    const childStart = entryOffset + 86
    const childEnd = Math.min(entryOffset + entrySize, buf.length)
    if (childStart >= childEnd)
        return []

    return findBoxes(buf, childStart, childEnd)
}

const AVC_PROFILE_NAMES: Record<number, string> = {
    66: 'Baseline', 77: 'Main', 88: 'Extended', 100: 'High',
    110: 'High 10', 122: 'High 4:2:2', 144: 'High 4:4:4', 244: 'High 4:4:4 Predictive'
}
const AVC_HIGH_FAMILY_PROFILES = new Set([100, 110, 122, 144, 244])

/**
 * AVCConfigurationRecord (ISO/IEC 14496-15 §5.3.3.1). Profile/level sit at fixed offsets,
 * no bitstream parsing needed. Chroma format/bit depth are only present for the "High"
 * profile family, and only *after* the variable-length SPS/PPS NAL unit lists - walking
 * those is just following declared lengths, not Exp-Golomb bitstream parsing.
 */
const parseAvcC = (buf: Buffer, avcCBox: Box): CodecDetails | undefined => {
    const start = avcCBox.bodyStart
    if (start + 4 > buf.length)
        return undefined

    const profileIdc = buf.readUInt8(start + 1)
    const levelIdc = buf.readUInt8(start + 3)
    const details: CodecDetails = {
        profile: AVC_PROFILE_NAMES[profileIdc] ?? `unknown (${profileIdc})`,
        profileId: profileIdc,
        level: (levelIdc / 10).toFixed(1)
    }

    if (!AVC_HIGH_FAMILY_PROFILES.has(profileIdc))
        return details

    try {
        let offset = start + 5
        if (offset >= buf.length) return details

        const numSps = buf.readUInt8(offset) & 0x1f
        offset += 1
        for (let i = 0; i < numSps; i++) {
            if (offset + 2 > buf.length) return details
            offset += 2 + buf.readUInt16BE(offset)
        }

        if (offset >= buf.length) return details
        const numPps = buf.readUInt8(offset)
        offset += 1
        for (let i = 0; i < numPps; i++) {
            if (offset + 2 > buf.length) return details
            offset += 2 + buf.readUInt16BE(offset)
        }

        if (offset + 3 > buf.length) return details
        details.chromaFormat = CHROMA_FORMAT_NAMES[buf.readUInt8(offset) & 0x03]
        details.bitDepthLuma = (buf.readUInt8(offset + 1) & 0x07) + 8
        details.bitDepthChroma = (buf.readUInt8(offset + 2) & 0x07) + 8
    }
    catch { /* extended fields are optional/best-effort - fall back to profile/level only */ }

    return details
}

const HEVC_PROFILE_NAMES: Record<number, string> = {
    1: 'Main', 2: 'Main 10', 3: 'Main Still Picture', 4: 'Range Extensions',
    5: 'High Throughput', 6: 'Multiview Main', 7: 'Scalable Main', 8: '3D Main',
    9: 'Screen Content Coding', 10: 'Scalable Range Extensions'
}

/**
 * HEVCConfigurationRecord (ISO/IEC 14496-15 §8.3.3.2.2). Unlike AVC, profile/tier/level
 * *and* chroma format/bit depth all live at fixed offsets in the record itself - no
 * variable-length walk needed.
 */
const parseHvcC = (buf: Buffer, hvcCBox: Box): CodecDetails | undefined => {
    const start = hvcCBox.bodyStart
    if (start + 19 > buf.length)
        return undefined

    const byte1 = buf.readUInt8(start + 1)
    const generalProfileIdc = byte1 & 0x1f
    const generalTierFlag = (byte1 >> 5) & 0x01
    const generalLevelIdc = buf.readUInt8(start + 12)
    const chromaFormatIdc = buf.readUInt8(start + 16) & 0x03

    return {
        profile: HEVC_PROFILE_NAMES[generalProfileIdc] ?? `unknown (${generalProfileIdc})`,
        profileId: generalProfileIdc,
        tier: generalTierFlag ? 'High' : 'Main',
        level: (generalLevelIdc / 30).toFixed(1),
        chromaFormat: CHROMA_FORMAT_NAMES[chromaFormatIdc],
        bitDepthLuma: (buf.readUInt8(start + 17) & 0x07) + 8,
        bitDepthChroma: (buf.readUInt8(start + 18) & 0x07) + 8
    }
}

const AV1_PROFILE_NAMES: Record<number, string> = { 0: 'Main', 1: 'High', 2: 'Professional' }

// AV1 level_idx -> level string, e.g. 0 -> "2.0", 7 -> "3.3" (spec table, 4 minor levels per major)
const av1Level = (levelIdx: number): string => `${2 + Math.floor(levelIdx / 4)}.${levelIdx % 4}`

/**
 * AV1CodecConfigurationRecord (av1-in-ISOBMFF spec, "Section 2.3.1: AV1CodecConfigurationBox").
 * Fully byte-aligned bit-packed fields - no bitstream OBU parsing needed for any of this.
 */
const parseAv1C = (buf: Buffer, av1CBox: Box): CodecDetails | undefined => {
    const start = av1CBox.bodyStart
    if (start + 3 > buf.length)
        return undefined

    const byte1 = buf.readUInt8(start + 1)
    const seqProfile = (byte1 >> 5) & 0x07
    const seqLevelIdx0 = byte1 & 0x1f

    const byte2 = buf.readUInt8(start + 2)
    const seqTier0 = (byte2 >> 7) & 0x01
    const highBitdepth = (byte2 >> 6) & 0x01
    const twelveBit = (byte2 >> 5) & 0x01
    const monochrome = (byte2 >> 4) & 0x01
    const chromaSubsamplingX = (byte2 >> 3) & 0x01
    const chromaSubsamplingY = (byte2 >> 2) & 0x01

    const bitDepth = twelveBit ? 12 : (highBitdepth ? 10 : 8)
    const chromaFormat = monochrome
        ? CHROMA_FORMAT_NAMES[0]
        : (chromaSubsamplingX && chromaSubsamplingY) ? '4:2:0'
        : (chromaSubsamplingX && !chromaSubsamplingY) ? '4:2:2'
        : '4:4:4'

    return {
        profile: AV1_PROFILE_NAMES[seqProfile] ?? `unknown (${seqProfile})`,
        profileId: seqProfile,
        tier: seqTier0 ? 'High' : 'Main',
        level: av1Level(seqLevelIdx0),
        chromaFormat,
        bitDepthLuma: bitDepth,
        bitDepthChroma: bitDepth,
        monochrome: !!monochrome
    }
}

const parseCodecDetails = (buf: Buffer, codec: string | undefined, stsdBox: Box): CodecDetails | undefined => {
    if (!codec)
        return undefined

    const childBoxes = findSampleEntryChildBoxes(buf, stsdBox)

    if (codec === 'avc1' || codec === 'avc3') {
        const avcCBox = findBox(childBoxes, 'avcC')
        return avcCBox ? parseAvcC(buf, avcCBox) : undefined
    }
    if (codec === 'hev1' || codec === 'hvc1') {
        const hvcCBox = findBox(childBoxes, 'hvcC')
        return hvcCBox ? parseHvcC(buf, hvcCBox) : undefined
    }
    if (codec === 'av01') {
        const av1CBox = findBox(childBoxes, 'av1C')
        return av1CBox ? parseAv1C(buf, av1CBox) : undefined
    }
    return undefined
}

const parseTkhdDimensions = (buf: Buffer, tkhdBox: Box): { width?: number, height?: number } => {
    if (tkhdBox.bodyStart >= buf.length)
        return {}

    const version = buf.readUInt8(tkhdBox.bodyStart)
    // v0: 4(version+flags)+4+4+4+4+4+8+2+2+2+2+36 = 76 bytes before width; v1 uses 8-byte times/duration fields
    const fixedFieldsSize = version === 1 ? 96 : 76
    const offset = tkhdBox.bodyStart + fixedFieldsSize

    if (offset + 8 > buf.length)
        return {}

    const width = buf.readUInt32BE(offset) >> 16
    const height = buf.readUInt32BE(offset + 4) >> 16
    return { width, height }
}

const parseTrak = (buf: Buffer, trakBox: Box): { handlerType?: string, codec?: string, width?: number, height?: number, codecDetails?: CodecDetails } => {
    const trakChildren = findBoxes(buf, trakBox.bodyStart, trakBox.bodyEnd)
    const tkhdBox = findBox(trakChildren, 'tkhd')
    const mdiaBox = findBox(trakChildren, 'mdia')
    if (!mdiaBox)
        return {}

    const mdiaChildren = findBoxes(buf, mdiaBox.bodyStart, mdiaBox.bodyEnd)
    const hdlrBox = findBox(mdiaChildren, 'hdlr')
    const minfBox = findBox(mdiaChildren, 'minf')
    const handlerType = hdlrBox ? parseHandlerType(buf, hdlrBox) : undefined

    let codec: string | undefined
    let codecDetails: CodecDetails | undefined
    if (minfBox) {
        const minfChildren = findBoxes(buf, minfBox.bodyStart, minfBox.bodyEnd)
        const stblBox = findBox(minfChildren, 'stbl')
        if (stblBox) {
            const stblChildren = findBoxes(buf, stblBox.bodyStart, stblBox.bodyEnd)
            const stsdBox = findBox(stblChildren, 'stsd')
            if (stsdBox) {
                codec = parseStsdCodec(buf, stsdBox)
                if (handlerType === 'vide')
                    codecDetails = parseCodecDetails(buf, codec, stsdBox)
            }
        }
    }

    const dimensions = (handlerType === 'vide' && tkhdBox) ? parseTkhdDimensions(buf, tkhdBox) : {}
    return { handlerType, codec, codecDetails, ...dimensions }
}

/**
 * Parses codec identity out of a head and/or tail chunk of an MP4 file, without requiring
 * the full file. Handles both "faststart" MP4s (moov near the start) and MP4s where moov
 * was written at the very end, right before EOF (the common case for non-faststart encodes).
 */
export const parseMp4Boxes = (headBuffer?: Buffer, tailBuffer?: Buffer): Mp4CodecInfo => {
    const result: Mp4CodecInfo = { moovLocation: 'not-found', incomplete: true }

    if (headBuffer?.length > 0) {
        const headBoxes = findBoxes(headBuffer, 0, headBuffer.length)
        const ftypBox = findBox(headBoxes, 'ftyp')
        if (ftypBox)
            result.containerBrand = parseFtyp(headBuffer, ftypBox)

        const moovBox = findBox(headBoxes, 'moov')
        if (moovBox) {
            applyMoov(headBuffer, moovBox, result)
            result.moovLocation = 'head'
            result.incomplete = false
        }
    }

    if (result.moovLocation === 'not-found' && tailBuffer?.length > 0) {
        const moovBox = findMoovBySignature(tailBuffer)
        if (moovBox) {
            applyMoov(tailBuffer, moovBox, result)
            result.moovLocation = 'tail'
            result.incomplete = false
        }
    }

    return result
}

const applyMoov = (buf: Buffer, moovBox: Box, result: Mp4CodecInfo): void => {
    const moovChildren = findBoxes(buf, moovBox.bodyStart, moovBox.bodyEnd)
    const trakBoxes = moovChildren.filter(b => b.type === 'trak')

    trakBoxes.forEach(trakBox => {
        const { handlerType, codec, width, height, codecDetails } = parseTrak(buf, trakBox)
        if (handlerType === 'vide') {
            result.videoCodec = codec
            if (width) result.width = width
            if (height) result.height = height
            if (codecDetails) result.codecDetails = codecDetails
        }
        else if (handlerType === 'soun') {
            result.audioCodec = codec
        }
    })
}
