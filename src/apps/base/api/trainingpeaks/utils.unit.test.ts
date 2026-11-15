import { trimXmlTextNodes } from './utils'

// the implementation that was replaced by a loop (a regular expression with a non-linear runtime for some inputs)
const reference = (xml: string) => xml.replaceAll(/>([^<]+)</g, (_match, text: string) => `>${text.trim()}<`)

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

    test.each([
        '',
        'text only',
        '<a>',
        '</a>',
        '<a>x',
        'x<a>',
        '<a>  x  </a>',
        '<a>\n  x  \n</a><b>  y </b>',
        '<a><b></b><c/> </a>',
        '<a> x > y </a>',
        '>>> a >>> <b> c </b> >>>',
        '<?xml version="1.0"?>\n<a x="1 > 0">\n  <b>  1  </b>\n</a>\n',
        '<a>   </a>',
        '<a>\t\r\n</a>',
        '  <a>1</a>  ',
        '<a>1</a>trailing   ',
        '<<a>>  1  <<b>>',
    ])('gives the same result as the implementation that was replaced: %j', (xml) => {
        expect(trimXmlTextNodes(xml)).toBe(reference(xml))
    })

    test('gives the same result for a generated document', () => {
        const xml = Array.from({ length: 300 }, (_v, i) => `<e${i}>\n    value ${i}  \n  </e${i}> `).join('\n')

        expect(trimXmlTextNodes(xml)).toBe(reference(xml))
    })

    // the regular expression needed a time that grows with the square of the length for input like this
    test.each([
        ['many closing brackets without any tag', '>'.repeat(200_000)],
        ['many closing brackets and one tag at the end', '>'.repeat(200_000) + '<a>'],
    ])('runtime is linear: %s', (_name, xml) => {
        const start = Date.now()

        const result = trimXmlTextNodes(xml)

        expect(Date.now() - start).toBeLessThan(500)
        expect(result.length).toBeGreaterThan(0)
    })
})
