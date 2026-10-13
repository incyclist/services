import fs from 'node:fs'
import path from 'node:path'

// Floating point results (e.g. heading, slope, distance) differ in the last digits between CPU
// architectures (Apple Silicon vs. x86) - numbers are therefore compared with a relative tolerance
// instead of exact (string) equality as in a snapshot
const RELATIVE_TOLERANCE = 1e-9

const numbersCloseTo = (a: unknown, b: unknown): boolean | undefined => {
    if (typeof a !== 'number' || typeof b !== 'number')
        return undefined
    if (Number.isNaN(a) || Number.isNaN(b))
        return Number.isNaN(a) && Number.isNaN(b)
    return Math.abs(a - b) <= RELATIVE_TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b))
}

/**
 * Compares a (large) result with a JSON fixture, tolerating floating point differences between platforms.
 * Run with `UPDATE_FIXTURES=1` to (re)create the fixture from the current result.
 */
export const expectToMatchFixture = (actual: unknown, fixture: string) => {
    const file = path.resolve(fixture)
    const normalized = JSON.parse(JSON.stringify(actual))

    if (process.env.UPDATE_FIXTURES === '1') {
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, JSON.stringify(normalized, null, 1))
        return
    }

    const expected = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(normalized).toEqual(expected)
}

// @types/jest 30.0.0's `Expect` interface omits `addEqualityTesters`, even though it exists on
// the `expect` package's own `BaseExpect` type and at runtime - cast locally rather than widen the
// global `Expect` type for the whole project.
;(expect as unknown as { addEqualityTesters(testers: Array<typeof numbersCloseTo>): void })
    .addEqualityTesters([numbersCloseTo])
