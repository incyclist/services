import { trimXmlTextNodes } from './utils'

describe('trimXmlTextNodes', () => {

    test('removes line breaks and padding around the value of an element', () => {
        expect(trimXmlTextNodes('<Id>\n      2026-11-15T06:00:00.000Z\n    </Id>')).toBe('<Id>2026-11-15T06:00:00.000Z</Id>')
    })

    test('handles the format written by the TCX exporter', () => {
        const xml = '<?xml version="1.0" encoding="utf-8"?>\n<Lap StartTime="2026-11-15T06:00:00.000Z">\n      <TotalTimeSeconds>\n      19.899\n    </TotalTimeSeconds><Calories>\n      0\n    </Calories>\n      <Track>\n      <Trackpoint>\n      <Time>\n      2026-11-15T06:00:01.000Z\n    </Time>\n    </Trackpoint>\n    </Track>\n    </Lap>'

        expect(trimXmlTextNodes(xml)).toBe(
            '<?xml version="1.0" encoding="utf-8"?><Lap StartTime="2026-11-15T06:00:00.000Z"><TotalTimeSeconds>19.899</TotalTimeSeconds><Calories>0</Calories><Track><Trackpoint><Time>2026-11-15T06:00:01.000Z</Time></Trackpoint></Track></Lap>'
        )
    })

    test('keeps attributes, namespaces and whitespace inside of a value', () => {
        const xml = '<a xmlns="http://example.com/v2" x="1  2"><Notes>\n  some  notes\n</Notes></a>'

        expect(trimXmlTextNodes(xml)).toBe('<a xmlns="http://example.com/v2" x="1  2"><Notes>some  notes</Notes></a>')
    })

    test('does not change a compact document', () => {
        const xml = '<a><b>1</b><c>2</c></a>'

        expect(trimXmlTextNodes(xml)).toBe(xml)
    })

    test('empty elements and empty strings', () => {
        expect(trimXmlTextNodes('<a></a><b/>')).toBe('<a></a><b/>')
        expect(trimXmlTextNodes('')).toBe('')
    })

    test('is fast on large files', () => {
        const point = '<Trackpoint>\n      <Time>\n      2026-11-15T06:00:01.000Z\n    </Time>\n    </Trackpoint>'
        const xml = '<Track>' + point.repeat(50_000) + '</Track>'

        const start = Date.now()
        const result = trimXmlTextNodes(xml)

        expect(Date.now() - start).toBeLessThan(1000)
        expect(result).toContain('<Time>2026-11-15T06:00:01.000Z</Time>')
    })
})
