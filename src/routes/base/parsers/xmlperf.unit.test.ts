import { XMLParser, XmlParserContext } from './xml'

// Regression test for a quadratic blowup in loadElevationFromPositions/getAltitude: when
// altitudes[] and positions[] are not index-aligned, the old code fell back to a full
// Array.find() scan of altitudes for every position (O(positions x altitudes)). Real-world
// routes with several thousand points took upwards of 10s to parse because of this.

describe('XMLParser.loadElevationFromPositions scaling', () => {

    const buildContext = (n: number): XmlParserContext => {
        // altitudes intentionally offset by 1 vs positions, so altitudes[i].distance !== positions[i].distance
        // for every i, forcing the (formerly O(n)) fallback lookup on every iteration.
        const positions = Array.from({ length: n }, (_, i) => ({
            lat: String(50 + i * 0.0001),
            lon: String(10 + i * 0.0001),
            distance: String(i * 10),
        }))
        const altitudes = Array.from({ length: n }, (_, i) => ({
            distance: String(i * 10 + 5), // shifted -> never matches positions[i].distance directly
            height: String(100 + (i % 50)),
        }))

        return {
            fileInfo: { dir: '', name: 'test', ext: 'xml', base: 'test.xml' } as any,
            data: { positions, altitudes },
            route: { points: [], distance: 0, elevation: 0 } as any,
        }
    }

    const time = async (n: number) => {
        const parser = new XMLParser()
        const context = buildContext(n)
        const start = performance.now()
        await (parser as any).loadElevationFromPositions(context)
        return performance.now() - start
    }

    it('scales roughly linearly with point count, not quadratically', async () => {
        const n1 = 1000
        const n2 = 4000

        const t1 = await time(n1)
        const t2 = await time(n2)

        // Linear scaling: 4x the points -> ~4x the time. A quadratic regression would show ~16x.
        // Generous threshold to absorb JIT warm-up / CI noise while still catching a real O(n^2).
        expect(t2 / t1).toBeLessThan(8)
    })
})
