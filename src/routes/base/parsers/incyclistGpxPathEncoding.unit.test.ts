import * as api from '../../../api'
import { FileInfo } from '../../../api'
import { IncyclistXMLParser, IncyclistParserContext } from './incyclist'

jest.mock('../../../api', () => {
    const actual = jest.requireActual('../../../api')
    return { ...actual, getBindings: jest.fn() }
})

// Real-world bug: on Android, a content:// URI's `path.parse()` (see mobile/src/bindings/path)
// decodes only the final segment (FileInfo.base/name), leaving the directory portion - and
// hence the full FileInfo.filename/url - percent-encoded. A route control file whose name
// contains characters that get percent-encoded (a space being the common case, e.g. an iOS
// Files-app "Duplicate" producing "<name> 2.xml") breaks the companion-GPX-path construction
// in IncyclistXMLParser.loadPoints(), which builds the companion path via
// `fileInfo.filename.replace(fileInfo.base, gpxFileName)` - a literal substring replace that
// silently no-ops when fileInfo.base (decoded) never appears as a substring of fileInfo.filename
// (still encoded), leaving the "companion" request pointed at the XML container file itself.

describe('IncyclistXMLParser: companion GPX path construction on content:// URIs', () => {
    const dirEncoded = 'content://com.example.provider/tree/ROOT%3APublic%2Fdata%2Fvideos%2Fniels%2FTEST'
    const containerUri = `${dirEncoded}%2FNoFast%202.xml`

    const fileInfo: FileInfo = {
        type: 'file',
        url: containerUri,
        filename: containerUri,
        base: 'NoFast 2.xml',
        name: 'NoFast 2',
        dir: dirEncoded,
        ext: 'xml',
        delimiter: '%2F',
    } as FileInfo

    let requestedFilenames: string[]

    beforeEach(() => {
        requestedFilenames = []
        ;(api.getBindings as jest.Mock).mockReturnValue({
            loader: {
                open: jest.fn((file: FileInfo) => {
                    requestedFilenames.push(file.filename)
                    // minimal valid GPX so the fast tokenizer (and its xml2js fallback) succeed
                    return Promise.resolve({
                        data: '<gpx><trk><trkseg><trkpt lat="1" lon="2"><ele>10</ele></trkpt></trkseg></trk></gpx>',
                    })
                }),
            },
        })
    })

    it('requests the companion .gpx file, not the XML container itself', async () => {
        const parser = new IncyclistXMLParser() as any
        const context: IncyclistParserContext = {
            fileInfo,
            data: { 'gpx-file-path': 'DK_10092026.gpx' },
            route: { points: [], distance: 0, elevation: 0 } as any,
        }

        await parser.loadPoints(context)

        const gpxRequest = requestedFilenames.find(f => f !== containerUri)
        expect(gpxRequest).toBeDefined()
        expect(gpxRequest).toContain('DK_10092026.gpx')
        expect(gpxRequest).not.toBe(containerUri)
    })
})
