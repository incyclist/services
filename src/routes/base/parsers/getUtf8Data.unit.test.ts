import { getUtf8Data } from './utils'

describe('getUtf8Data', () => {

    it('plain UTF-8 string, no BOM -> returned unchanged', () => {
        const input = '<?xml version="1.0"?><gpx></gpx>'
        expect(getUtf8Data(input)).toBe(input)
    })

    it('string with a leading U+FEFF codepoint (already UTF-8 decoded) -> BOM stripped', () => {
        const input = '﻿<?xml version="1.0"?><gpx></gpx>'
        expect(getUtf8Data(input)).toBe('<?xml version="1.0"?><gpx></gpx>')
    })

    it('Buffer with a UTF-8 BOM (EF BB BF) -> decoded, BOM stripped', () => {
        const body = '<?xml version="1.0"?><gpx></gpx>'
        const input = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(body, 'utf-8')])
        expect(getUtf8Data(input)).toBe(body)
    })

    it('byte-per-char ("binary") string carrying a UTF-8 BOM -> properly re-decoded, BOM stripped', () => {
        const body = '<?xml version="1.0"?><gpx></gpx>'
        const raw = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(body, 'utf-8')])
        const input = raw.toString('binary')
        expect(getUtf8Data(input)).toBe(body)
    })

    it('Buffer with a UTF-16 BE BOM (FE FF) -> decoded to a proper UTF-8 string', () => {
        const body = 'hello'
        const utf16be = Buffer.alloc(body.length * 2)
        for (let i = 0; i < body.length; i++) {
            utf16be[i * 2] = 0
            utf16be[i * 2 + 1] = body.charCodeAt(i)
        }
        const input = Buffer.concat([Buffer.from([0xFE, 0xFF]), utf16be])
        expect(getUtf8Data(input)).toBe(body)
    })

    it('Buffer with a UTF-16 LE BOM (FF FE) -> decoded to a proper UTF-8 string', () => {
        const body = 'hello'
        const input = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(body, 'utf16le')])
        expect(getUtf8Data(input)).toBe(body)
    })

    it('a large payload with no BOM resolves quickly (does not transcode the whole string)', () => {
        const large = '<?xml version="1.0"?>' + 'x'.repeat(3_000_000)
        const start = performance.now()
        const result = getUtf8Data(large)
        const duration = performance.now() - start

        expect(result).toBe(large)
        expect(duration).toBeLessThan(200)
    })
})
