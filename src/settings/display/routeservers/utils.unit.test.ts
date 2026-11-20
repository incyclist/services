import { formatSize, suggestServerName } from './utils'

describe('suggestServerName', () => {
    test.each([
        ['videos.alpine-club.org', 'Alpine Club'],
        ['nas.local', 'Nas'],
        ['nas', 'Nas'],
        ['my-nas.local:5000', 'My Nas'],
        ['example.org', 'Example'],
        ['videos.club.co.uk', 'Club'],
        ['localhost:8080', 'Localhost'],
    ])('%s -> %s', (host, expected) => {
        expect(suggestServerName(host)).toBe(expected)
    })

    test.each(['192.168.1.20', '192.168.1.20:8080', '[::1]:8080', '', undefined])('no suggestion for %s', (host) => {
        expect(suggestServerName(host)).toBeUndefined()
    })
})

describe('formatSize', () => {
    test.each([
        [0, '0 B'],
        [512, '512 B'],
        [1536, '1.5 KB'],
        [5 * 1024 * 1024, '5.0 MB'],
        [1.2 * 1024 ** 3, '1.2 GB'],
        [250 * 1024 ** 3, '250 GB'],
    ])('%d -> %s', (bytes, expected) => {
        expect(formatSize(bytes)).toBe(expected)
    })
})
