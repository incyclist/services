import { JSONObject } from '../../../utils/xml'

/**
 * Fast, GPX-specific replacement for running a route's companion GPX file through the
 * generic xml2js-based pipeline (see utils/xml.ts#parseXml). xml2js's SAX-style parsing is
 * fine on V8 but measured at ~27x slower on Hermes for a real multi-MB, multi-thousand-point
 * GPX export (323ms on Node vs 8.7s on an Android device, same file) - the dominant cost of
 * a slow route-library import.
 *
 * This intentionally only extracts what GPXParser actually reads: trk/trkseg/trkpt with
 * lat/lon/ele/time, and metadata/trk name+desc. It never looks at <extensions> (heart rate,
 * cadence, power, temperature) since GPXParser doesn't either - that's most of a real
 * ride-recording GPX's bulk.
 *
 * Returns undefined (never throws) whenever the input doesn't look exactly as expected, so
 * the caller can fall back to the real xml2js pipeline. It is not a general XML parser and
 * must never be used as one - it purely mimics xml2js's raw output shape (arrays, `$` for
 * attributes) for this narrow slice, so the result can be handed to the existing, unit-tested
 * XmlJSON.map() unchanged.
 */

type RawGpxPoint = { $: { lat?: string, lon?: string }, ele?: string[], time?: string[] }

const decodeEntities = (s: string): string =>
    s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

const parseAttrs = (tagText: string): Record<string, string> => {
    const attrs: Record<string, string> = {}
    const re = /([\w:.-]+)\s*=\s*"([^"]*)"|([\w:.-]+)\s*=\s*'([^']*)'/g
    let m: RegExpExecArray | null
    while ((m = re.exec(tagText))) {
        if (m[1] !== undefined) attrs[m[1]] = m[2]
        else attrs[m[3]] = m[4]
    }
    return attrs
}

const CDATA_RE = /^<!\[CDATA\[([\s\S]*)\]\]>$/

/**
 * Extracts the text content of the first occurrence of a simple (non-nested) leaf tag, e.g.
 * <ele>24.8</ele> inside a <trkpt>. Pure indexOf - no regex - since this runs per point (twice)
 * across tens of thousands of points; a `new RegExp(...)` per call was real, measurable cost.
 */
const extractLeaf = (block: string, tag: string): string | undefined => {
    const openTag = `<${tag}`
    const start = block.indexOf(openTag)
    if (start === -1) return undefined

    const afterName = block[start + 1 + tag.length]
    if (afterName !== undefined && !/[\s>/]/.test(afterName)) return undefined

    const tagEnd = block.indexOf('>', start)
    if (tagEnd === -1) return undefined
    if (block[tagEnd - 1] === '/') return '' // self-closing leaf, no content

    const closeTag = `</${tag}>`
    const closeIdx = block.indexOf(closeTag, tagEnd)
    if (closeIdx === -1) return undefined

    const raw = block.slice(tagEnd + 1, closeIdx).trim()
    const cdata = CDATA_RE.exec(raw)
    // CDATA content is literal - no entity decoding, unlike ordinary element text.
    return cdata ? cdata[1] : decodeEntities(raw)
}

/** Splits `text` into the top-level (non-nested) blocks for one tag name, e.g. all <trk>...</trk>. */
const extractBlocks = (text: string, tag: string): Array<{ body: string }> | undefined => {
    const blocks: Array<{ body: string }> = []
    let idx = 0
    while (true) {
        const start = text.indexOf(`<${tag}`, idx)
        if (start === -1) break

        // avoid matching a longer tag name that happens to share this prefix (<trk vs <trkseg)
        const afterName = text[start + 1 + tag.length]
        if (afterName !== undefined && !/[\s>/]/.test(afterName)) {
            idx = start + 1
            continue
        }

        const tagEnd = text.indexOf('>', start)
        if (tagEnd === -1) return undefined

        if (text[tagEnd - 1] === '/') {
            blocks.push({ body: '' })
            idx = tagEnd + 1
            continue
        }

        const closeTag = `</${tag}>`
        const closeIdx = text.indexOf(closeTag, tagEnd)
        if (closeIdx === -1) return undefined

        blocks.push({ body: text.slice(tagEnd + 1, closeIdx) })
        idx = closeIdx + closeTag.length
    }
    return blocks
}

const extractTrkpts = (segBody: string): RawGpxPoint[] | undefined => {
    const points: RawGpxPoint[] = []
    let idx = 0
    while (true) {
        const start = segBody.indexOf('<trkpt', idx)
        if (start === -1) break

        const afterName = segBody[start + 6]
        if (afterName !== undefined && !/[\s>/]/.test(afterName)) {
            idx = start + 1
            continue
        }

        const tagEnd = segBody.indexOf('>', start)
        if (tagEnd === -1) return undefined

        const selfClosing = segBody[tagEnd - 1] === '/'
        const attrs = parseAttrs(segBody.slice(start, tagEnd + 1))

        const point: RawGpxPoint = { $: { lat: attrs.lat, lon: attrs.lon } }

        if (selfClosing) {
            idx = tagEnd + 1
        }
        else {
            const closeIdx = segBody.indexOf('</trkpt>', tagEnd)
            if (closeIdx === -1) return undefined
            const body = segBody.slice(tagEnd + 1, closeIdx)

            const ele = extractLeaf(body, 'ele')
            if (ele !== undefined) point.ele = [ele]
            const time = extractLeaf(body, 'time')
            if (time !== undefined) point.time = [time]

            idx = closeIdx + '</trkpt>'.length
        }

        points.push(point)
    }
    return points
}

export const tryParseGpxRaw = (xmlText: string): JSONObject | undefined => {
    try {
        if (!/<gpx[\s>]/.test(xmlText))
            return undefined

        const trkBlocks = extractBlocks(xmlText, 'trk')
        if (!trkBlocks || trkBlocks.length === 0)
            return undefined

        const trk: JSONObject[] = []
        for (const { body } of trkBlocks) {
            const segStart = body.search(/<trkseg[\s>]/)
            const header = segStart === -1 ? body : body.slice(0, segStart)

            const segBlocks = extractBlocks(body, 'trkseg')
            if (!segBlocks)
                return undefined

            const trkseg: JSONObject[] = []
            for (const seg of segBlocks) {
                const points = extractTrkpts(seg.body)
                if (!points)
                    return undefined
                trkseg.push({ trkpt: points } as unknown as JSONObject)
            }

            const trkObj: Record<string, JSONObject> = { trkseg }
            const name = extractLeaf(header, 'name')
            if (name !== undefined) trkObj.name = [name]
            const desc = extractLeaf(header, 'desc')
            if (desc !== undefined) trkObj.desc = [desc]

            trk.push(trkObj)
        }

        const gpx: Record<string, JSONObject> = { trk }

        const metaMatch = /<metadata[\s>][\s\S]*?<\/metadata>/.exec(xmlText)
        if (metaMatch) {
            // <author> is the only standard GPX metadata child that can itself carry a <name>
            // (personType: name/email/link) - strip it out before searching, rather than
            // assuming metadata's own children appear in the schema's suggested order (real
            // exporters, e.g. Garmin Connect, routinely put <link>/<time> before <name>).
            const openEnd = metaMatch[0].indexOf('>')
            const closeStart = metaMatch[0].lastIndexOf('</metadata>')
            const body = metaMatch[0].slice(openEnd + 1, closeStart).replace(/<author[\s>][\s\S]*?<\/author>/, '')
            const name = extractLeaf(body, 'name')
            if (name !== undefined)
                gpx.metadata = [{ name: [name] }] as unknown as JSONObject
        }

        // Safety net: if we somehow dropped or double-counted points relative to a plain
        // occurrence count of '<trkpt', don't risk silently corrupting the route - fall back.
        const foundPoints = trk.reduce((sum: number, t: any) =>
            sum + t.trkseg.reduce((s: number, seg: any) => s + seg.trkpt.length, 0), 0)
        const literalCount = (xmlText.match(/<trkpt[\s>]/g) ?? []).length
        if (foundPoints !== literalCount)
            return undefined

        return { gpx } as unknown as JSONObject
    }
    catch {
        return undefined
    }
}
