export type Mp4CodecInfo = {
    containerBrand?: string
    videoCodec?: string
    audioCodec?: string
    width?: number
    height?: number
    moovLocation?: 'head' | 'tail' | 'not-found'
    incomplete?: boolean
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

const parseTrak = (buf: Buffer, trakBox: Box): { handlerType?: string, codec?: string, width?: number, height?: number } => {
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
    if (minfBox) {
        const minfChildren = findBoxes(buf, minfBox.bodyStart, minfBox.bodyEnd)
        const stblBox = findBox(minfChildren, 'stbl')
        if (stblBox) {
            const stblChildren = findBoxes(buf, stblBox.bodyStart, stblBox.bodyEnd)
            const stsdBox = findBox(stblChildren, 'stsd')
            if (stsdBox)
                codec = parseStsdCodec(buf, stsdBox)
        }
    }

    const dimensions = (handlerType === 'vide' && tkhdBox) ? parseTkhdDimensions(buf, tkhdBox) : {}
    return { handlerType, codec, ...dimensions }
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
        const { handlerType, codec, width, height } = parseTrak(buf, trakBox)
        if (handlerType === 'vide') {
            result.videoCodec = codec
            if (width) result.width = width
            if (height) result.height = height
        }
        else if (handlerType === 'soun') {
            result.audioCodec = codec
        }
    })
}
