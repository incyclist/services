import {
    createUnsupportedProtocolError, isLinkProtocolAccepted, isLinkProtocolRange, negotiateLinkHello, negotiateLinkProtocol,
} from './version'
import { LINK_PROTOCOL_RANGE } from './consts'
import type { LinkProtocolRange } from './types'

const range = (minMajor: number, minMinor: number, maxMajor: number, maxMinor: number): LinkProtocolRange =>
    ({ min: { major: minMajor, minor: minMinor }, max: { major: maxMajor, minor: maxMinor } })

describe('link protocol version', () => {
    describe('isLinkProtocolRange', () => {
        test('accepts ordered ranges', () => {
            expect(isLinkProtocolRange(range(1, 0, 1, 0))).toBe(true)
            expect(isLinkProtocolRange(range(1, 5, 2, 0))).toBe(true)
        })

        test('rejects reversed or malformed ranges', () => {
            expect(isLinkProtocolRange(range(2, 0, 1, 9))).toBe(false)
            expect(isLinkProtocolRange(range(1, 2, 1, 1))).toBe(false)
            expect(isLinkProtocolRange({ min: { major: 1 }, max: { major: 1, minor: 0 } })).toBe(false)
            expect(isLinkProtocolRange(range(-1, 0, 1, 0))).toBe(false)
            expect(isLinkProtocolRange(null)).toBe(false)
        })
    })

    describe('negotiateLinkProtocol', () => {
        test('picks the same version for identical ranges', () => {
            expect(negotiateLinkProtocol(range(1, 0, 1, 0), range(1, 0, 1, 0))).toEqual({ major: 1, minor: 0 })
        })

        test('picks the highest common major', () => {
            expect(negotiateLinkProtocol(range(1, 0, 3, 1), range(2, 0, 4, 0))).toEqual({ major: 3, minor: 1 })
            expect(negotiateLinkProtocol(range(1, 0, 2, 4), range(1, 0, 3, 0))).toEqual({ major: 2, minor: 4 })
        })

        test('picks the lower of both highest minors within the major', () => {
            expect(negotiateLinkProtocol(range(1, 0, 1, 3), range(1, 0, 1, 1))).toEqual({ major: 1, minor: 1 })
        })

        test('treats minors as compatible even below the other end\'s minimum minor', () => {
            expect(negotiateLinkProtocol(range(1, 2, 1, 4), range(1, 0, 1, 1))).toEqual({ major: 1, minor: 1 })
        })

        test('returns undefined without a common major', () => {
            expect(negotiateLinkProtocol(range(2, 0, 2, 3), range(1, 0, 1, 9))).toBeUndefined()
            expect(negotiateLinkProtocol(range(1, 0, 1, 0), range(2, 0, 3, 0))).toBeUndefined()
        })

        test('returns undefined for a malformed range', () => {
            expect(negotiateLinkProtocol({} as never)).toBeUndefined()
        })

        test('defaults to the library range', () => {
            expect(negotiateLinkProtocol(LINK_PROTOCOL_RANGE)).toEqual(LINK_PROTOCOL_RANGE.max)
        })
    })

    describe('negotiateLinkHello', () => {
        test('negotiates a client hello', () => {
            expect(negotiateLinkHello({ role: 'client', protocol: range(1, 0, 2, 0) }, range(1, 0, 1, 2))).toEqual({ major: 1, minor: 2 })
        })

        test('refuses an unknown major', () => {
            expect(negotiateLinkHello({ role: 'client', protocol: range(2, 0, 2, 0) }, range(1, 0, 1, 0))).toBeUndefined()
        })

        test('rejects a hello without client role', () => {
            expect(negotiateLinkHello({ role: 'server', protocol: range(1, 0, 1, 0) } as never)).toBeUndefined()
            expect(negotiateLinkHello(undefined as never)).toBeUndefined()
        })
    })

    describe('createUnsupportedProtocolError', () => {
        test('names the code and the supported range', () => {
            expect(createUnsupportedProtocolError(range(1, 0, 1, 3))).toEqual({ code: 'unsupported-protocol', supported: range(1, 0, 1, 3) })
        })
    })

    describe('isLinkProtocolAccepted', () => {
        test('accepts any minor of a supported major', () => {
            expect(isLinkProtocolAccepted({ major: 1, minor: 7 }, range(1, 0, 1, 0))).toBe(true)
        })

        test('refuses an unknown major', () => {
            expect(isLinkProtocolAccepted({ major: 2, minor: 0 }, range(1, 0, 1, 9))).toBe(false)
            expect(isLinkProtocolAccepted({ major: 0, minor: 0 }, range(1, 0, 1, 9))).toBe(false)
        })

        test('refuses a malformed version', () => {
            expect(isLinkProtocolAccepted({ major: 1 } as never)).toBe(false)
        })
    })
})
