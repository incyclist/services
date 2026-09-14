import * as fs from 'fs'
import * as path from 'path'
import { FileInfo } from '../../../api'
import { JSONObject, XmlJSON, parseXml } from '../../../utils/xml'
import { GPXParser } from './gpx'
import { XmlParserContext } from './xml'
import { tryParseGpxRaw } from './gpxFast'

// Proves the fast GPX tokenizer (gpxFast.ts) produces output that the real, unchanged
// GPXParser consuming code (loadDescription/loadPoints) treats identically to the generic
// xml2js pipeline it replaces - run against every real GPX fixture already in the repo, not
// just hand-built samples.

const fixtureDirs = [
    path.join(__dirname, '../../../../__tests__/data/routes'),
    path.join(__dirname, '../../../../__tests__/data/rlv'),
]

const fixtures = fixtureDirs.flatMap(dir =>
    fs.readdirSync(dir).filter(f => f.endsWith('.gpx')).map(f => path.join(dir, f))
)

const buildRoute = async (data: JSONObject, fileInfo: FileInfo) => {
    const parser = new GPXParser({ addTime: false }) as any
    const context: XmlParserContext = { fileInfo, data }
    await parser.loadDescription(context)
    await parser.loadPoints(context)
    return context.route
}

describe('gpxFast equivalence with the generic xml2js pipeline', () => {

    it('found at least one .gpx fixture to test against', () => {
        expect(fixtures.length).toBeGreaterThan(0)
    })

    fixtures.forEach(file => {
        it(`matches xml2js output for ${path.basename(file)}`, async () => {
            const text = fs.readFileSync(file, 'utf8')
            const fileInfo: FileInfo = { type: 'file', name: path.basename(file, '.gpx'), ext: 'gpx', dir: path.dirname(file), url: undefined, delimiter: '/' }

            const oldXml = await parseXml(text)
            oldXml.expectScheme('gpx')
            const oldRoute = await buildRoute(oldXml.json, fileInfo)

            const fastRaw = tryParseGpxRaw(text)
            expect(fastRaw).toBeDefined() // every real fixture must hit the fast path, not silently fall back

            const newXml = new XmlJSON(fastRaw, 'gpx')
            const newRoute = await buildRoute(newXml.json, fileInfo)

            expect(newRoute.points).toEqual(oldRoute.points)
            expect(newRoute.title).toEqual(oldRoute.title)
            expect(newRoute.localizedTitle).toEqual(oldRoute.localizedTitle)
            expect(newRoute.description).toEqual(oldRoute.description)
        })
    })

    it('falls back (returns undefined) for content with no <trk> at all', () => {
        expect(tryParseGpxRaw('<gpx></gpx>')).toBeUndefined()
    })

    it('falls back for non-GPX content', () => {
        expect(tryParseGpxRaw('<not-gpx><foo/></not-gpx>')).toBeUndefined()
    })

    it('falls back for a truncated/malformed trkpt (no closing tag)', () => {
        const broken = '<gpx><trk><trkseg><trkpt lat="1" lon="2"><ele>10</ele></trkseg></trk></gpx>'
        expect(tryParseGpxRaw(broken)).toBeUndefined()
    })

    it('does not mistake a nested <author><name> for metadata\'s own name (found via a real 138-file library scan)', () => {
        const xml = `<gpx>
            <metadata><author><name>http://dlg.krakow.pl/gpx</name></author><bounds minlat="1" minlon="1" maxlat="2" maxlon="2"/></metadata>
            <trk><name>RealRouteName</name><trkseg><trkpt lat="1" lon="1"><ele>10</ele></trkpt></trkseg></trk>
        </gpx>`
        const raw = tryParseGpxRaw(xml)
        expect(raw).toBeDefined()
        const mapped = new XmlJSON(raw, 'gpx').json as any
        expect(mapped.metadata).toBeUndefined()
        expect(mapped.trk.name).toBe('RealRouteName')
    })

    it('finds metadata\'s <name> even when other siblings come first (real exporters don\'t follow the schema order)', () => {
        const xml = `<gpx>
            <metadata><link href="connect.garmin.com"><text>Garmin Connect</text></link><time>2025-02-02T10:24:15.000Z</time><name>Smoothed Ride</name><desc>d</desc></metadata>
            <trk><name>RealRouteName</name><trkseg><trkpt lat="1" lon="1"><ele>10</ele></trkpt></trkseg></trk>
        </gpx>`
        const raw = tryParseGpxRaw(xml)
        expect(raw).toBeDefined()
        const mapped = new XmlJSON(raw, 'gpx').json as any
        expect(mapped.metadata.name).toBe('Smoothed Ride')
    })

    it('picks up metadata\'s own <name> when it really is a direct child', () => {
        const xml = `<gpx>
            <metadata><name>RealMetadataName</name><author><name>someone</name></author></metadata>
            <trk><trkseg><trkpt lat="1" lon="1"><ele>10</ele></trkpt></trkseg></trk>
        </gpx>`
        const raw = tryParseGpxRaw(xml)
        expect(raw).toBeDefined()
        const mapped = new XmlJSON(raw, 'gpx').json as any
        expect(mapped.metadata.name).toBe('RealMetadataName')
    })

    it('handles single-quoted attributes (all real fixtures use double quotes, so this path is otherwise untested)', () => {
        const xml = "<gpx><trk><trkseg><trkpt lat='1.5' lon='2.5'><ele>12</ele></trkpt></trkseg></trk></gpx>"
        const raw = tryParseGpxRaw(xml)
        expect(raw).toBeDefined()
        const mapped = new XmlJSON(raw, 'gpx').json as any
        expect(mapped.trk.trkseg.trkpt).toEqual({ lat: '1.5', lon: '2.5', ele: '12' })
    })

    it('handles a self-closing trkpt with no children', () => {
        const xml = '<gpx><trk><trkseg><trkpt lat="1.0" lon="2.0"/></trkseg></trk></gpx>'
        const raw = tryParseGpxRaw(xml)
        expect(raw).toBeDefined()
        const mapped = new XmlJSON(raw, 'gpx').json as any
        // a single trkpt collapses from a 1-element array to a plain object - same as xml2js+map() would do
        expect(mapped.trk.trkseg.trkpt).toEqual({ lat: '1.0', lon: '2.0' })
    })

    it('handles multiple <trk> and <trkseg> blocks', async () => {
        const xml = `<gpx>
            <trk><name>First</name><trkseg><trkpt lat="1" lon="1"><ele>10</ele></trkpt></trkseg></trk>
            <trk><name>Second</name><trkseg><trkpt lat="2" lon="2"><ele>20</ele></trkpt></trkseg><trkseg><trkpt lat="3" lon="3"><ele>30</ele></trkpt></trkseg></trk>
        </gpx>`

        const oldXml = await parseXml(xml)
        oldXml.expectScheme('gpx')
        const fastRaw = tryParseGpxRaw(xml)
        expect(fastRaw).toBeDefined()
        const newXml = new XmlJSON(fastRaw, 'gpx')

        expect(newXml.json).toEqual(oldXml.json)
    })
})
