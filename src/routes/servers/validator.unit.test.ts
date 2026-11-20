import { isAllowedRedirectTarget, isHomeNetworkHost, normalizeRouteServerUrl, toSourceLabel, validateRouteServerName, validateRouteServerUrl } from './validator'

describe('validateRouteServerName', () => {
    const ctx = { reservedNames: ['Strava', 'Komoot', 'Intervals.icu', 'intervals'], existingNames: ['Alpine Videos'] }

    test('N1 plain name', () => {
        expect(validateRouteServerName('Alpine Videos')).toEqual({ valid: true, name: 'Alpine Videos' })
    })
    test('N2 trims and collapses spaces', () => {
        expect(validateRouteServerName('  Alpine    Videos  ')).toEqual({ valid: true, name: 'Alpine Videos' })
    })
    test('N3 unicode letters', () => {
        expect(validateRouteServerName('Müller-Touren').valid).toBe(true)
    })
    test('N3 normalises to NFC', () => {
        const res = validateRouteServerName('Müller')
        expect(res).toEqual({ valid: true, name: 'Müller' })
    })
    test.each([
        ['N4', 'Alpine":"https://malicious"\n"test'],
        ['N5', 'Alpine.Videos'],
        ['N6', 'routes\\servers'],
        ['N7a', 'Alpine{x}'],
        ['N7b', 'Alpine[0]'],
        ['N8a', 'Alpine\tVideos'],
        ['N8b', 'Alpine\nVideos'],
        ['N9', 'Alpine​Videos'],
        ['N13', 'a'.repeat(25)],
        ['N14', '-Alpine'],
        ['N15', '🚴 Rides'],
    ])('%s rejected: %s', (_id, input) => {
        const res = validateRouteServerName(input, ctx)
        expect(res.valid).toBe(false)
        if (!res.valid) {
            expect(res.code).toBe('format')
            expect(res.message).toBe('Use up to 24 letters, numbers, spaces or dashes.')
        }
    })
    test('24 characters are accepted', () => {
        expect(validateRouteServerName('a'.repeat(24)).valid).toBe(true)
    })
    test.each(['__proto__', 'constructor', 'Prototype'])('N10 reserved word %s', (input) => {
        const res = validateRouteServerName(input, ctx)
        expect(res).toMatchObject({ valid: false, code: 'reserved-word', message: "This name can't be used. Choose another name." })
    })
    test.each(['strava', 'Local', 'INCYCLIST', 'komoot', 'intervals'])('N11 reserved source %s', (input) => {
        const res = validateRouteServerName(input, ctx)
        expect(res).toMatchObject({ valid: false, code: 'reserved-source' })
    })
    test('N11 message names the clashing input', () => {
        const res = validateRouteServerName('strava', ctx)
        expect(res.valid === false && res.message).toBe("'strava' is already used as a source in Incyclist. Choose another name.")
    })
    test('N12 same pascalCase as an existing server', () => {
        const res = validateRouteServerName('alpine-videos', ctx)
        expect(res).toMatchObject({ valid: false, code: 'duplicate', message: "You already have a server called 'Alpine Videos'. Choose another name." })
    })
    test('N16 empty name', () => {
        expect(validateRouteServerName('   ')).toMatchObject({ valid: false, code: 'empty' })
        expect(validateRouteServerName(undefined)).toMatchObject({ valid: false, code: 'empty' })
    })
})

describe('validateRouteServerUrl', () => {
    const allow = { allowsLocalHttp: true }

    const expectInvalid = (input: string, code: string, ctx = allow) => {
        const res = validateRouteServerUrl(input, ctx)
        expect(res.valid).toBe(false)
        if (!res.valid)
            expect(res.code).toBe(code)
    }
    const expectLocal = (input: string) => {
        const res = validateRouteServerUrl(input, allow)
        expect(res).toMatchObject({ valid: true, isLocal: true })
    }

    test('U1 no scheme gets https', () => {
        const res = validateRouteServerUrl('videos.example.org')
        expect(res).toMatchObject({ valid: true, url: 'https://videos.example.org/', schemeTyped: false, isLocal: false })
    })
    test('U2 trimmed', () => {
        const res = validateRouteServerUrl('  https://videos.example.org/api/v1/routes  ')
        expect(res).toMatchObject({ valid: true, url: 'https://videos.example.org/api/v1/routes', schemeTyped: true })
    })
    test('empty address has no message', () => {
        const res = validateRouteServerUrl('  ')
        expect(res).toEqual({ valid: false, code: 'empty', message: undefined })
    })
    test('U3 http to the internet', () => {
        const res = validateRouteServerUrl('http://videos.example.org')
        expect(res).toMatchObject({ valid: false, code: 'http-internet' })
    })
    test.each([
        ['U4', 'https://videos.example.org/a b', 'whitespace'],
        ['U5', 'https://videos.example.org/\n"test"', 'whitespace'],
        ['U6', 'https://videos.example.org/"}', 'not-a-url'],
        ['U7', 'https://user:pw@videos.example.org', 'credentials'],
        ['U8', 'https://videos.example.org/#frag', 'not-a-url'],
        ['U9a', 'javascript:alert(1)', 'not-a-url'],
        ['U9b', 'file:///etc/passwd', 'not-a-url'],
        ['U9c', 'ftp://x', 'not-a-url'],
        ['U10a', 'https://', 'not-a-url'],
        ['U10b', 'https:///path', 'not-a-url'],
        ['U12', `https://videos.example.org/${'a'.repeat(2040)}`, 'not-a-url'],
        ['U13a', 'https://videos.example.org/api?type=video', 'query'],
        ['U13b', 'https://videos.example.org?x=1', 'query'],
        ['U13c', 'videos.example.org/?', 'query'],
        ['L5a', 'http://172.32.0.1', 'http-internet'],
        ['L5b', 'http://172.15.255.255', 'http-internet'],
        ['L11', 'http://192.168.1.1.evil.com', 'http-internet'],
        ['L12', 'http://localhost@evil.com', 'credentials'],
        ['L13', 'http://evil.com#@localhost', 'not-a-url'],
        ['L14', 'http://evil.com\\@localhost', 'not-a-url'],
        ['L15a', 'http://localhost.evil.com', 'http-internet'],
        ['L15b', 'http://evil.local.com', 'http-internet'],
        ['L15c', 'http://127.0.0.1.nip.io', 'http-internet'],
        ['L16', 'http://3232235777', 'http-internet'],
        ['L17a', 'http://0xC0A80101', 'http-internet'],
        ['L17b', 'http://0xc0.0xa8.1.1', 'http-internet'],
        ['L18a', 'http://0300.0250.1.1', 'http-internet'],
        ['L18b', 'http://192.168.001.001', 'http-internet'],
        ['L19a', 'http://127.1', 'http-internet'],
        ['L19b', 'http://192.168.1', 'http-internet'],
        ['L20a', 'http://[::ffff:192.168.1.1]', 'http-internet'],
        ['L20b', 'http://[::ffff:c0a8:101]', 'http-internet'],
        ['L21a', 'http://[fe80::1]', 'http-internet'],
        ['L21b', 'http://[fd00::1]', 'http-internet'],
        ['L22', 'http://localhost.', 'http-internet'],
        ['L23a', 'http://0.0.0.0', 'http-internet'],
        ['L23b', 'http://100.64.0.1', 'http-internet'],
        ['L24a', 'http://my_nas', 'http-internet'],
        ['L24b', 'http://123.local', 'http-internet'],
        ['L24c', 'http://1234', 'http-internet'],
        ['L25', 'http://bücher.local', 'http-internet'],
    ])('%s rejected: %s', (_id, input, code) => {
        expectInvalid(input, code)
    })

    test.each([
        ['L1', 'http://localhost:8080'],
        ['L2', 'http://127.0.0.1/routes'],
        ['L3', 'http://192.168.1.20:8080'],
        ['L4a', 'http://10.0.0.5'],
        ['L4b', 'http://172.16.0.1'],
        ['L4c', 'http://172.31.255.255'],
        ['L6', 'http://169.254.10.10'],
        ['L7', 'http://[::1]:8080'],
        ['L8a', 'http://nas:8080'],
        ['L8b', 'http://NAS:8080'],
        ['L9a', 'http://nas.local'],
        ['L9b', 'http://my-nas.local:5000'],
        ['L10', 'https://192.168.1.20'],
    ])('%s home network accepted: %s', (_id, input) => {
        expectLocal(input)
    })

    test('L1 http on the home network is flagged as unencrypted', () => {
        expect(validateRouteServerUrl('http://localhost:8080', allow)).toMatchObject({ isLocal: true, isUnencrypted: true })
    })
    test('L10 https on the home network is not flagged', () => {
        expect(validateRouteServerUrl('https://192.168.1.20', allow)).toMatchObject({ isLocal: true, isUnencrypted: false })
    })
    test('L8 http://NAS resolves to a lower case host', () => {
        expect(validateRouteServerUrl('http://NAS:8080', allow)).toMatchObject({ host: 'nas:8080' })
    })

    test('L26 no scheme on the home network: https first, http fallback offered', () => {
        const res = validateRouteServerUrl('nas:8080', allow)
        expect(res).toMatchObject({
            valid: true, url: 'https://nas:8080/', schemeTyped: false, isLocal: true,
            httpFallbackUrl: 'http://nas:8080/'
        })
    })
    test('L26 no http fallback if the platform does not allow it', () => {
        const res = validateRouteServerUrl('nas:8080', { allowsLocalHttp: false })
        expect(res).toMatchObject({ valid: true, url: 'https://nas:8080/' })
        expect(res).not.toHaveProperty('httpFallbackUrl')
    })
    test('L27 no scheme on the internet: never an http fallback', () => {
        const res = validateRouteServerUrl('videos.example.org', allow)
        expect(res).not.toHaveProperty('httpFallbackUrl')
    })
    test('http fallback is not offered if the scheme was typed', () => {
        const res = validateRouteServerUrl('https://nas:8080', allow)
        expect(res).not.toHaveProperty('httpFallbackUrl')
    })

    test('L29 home-network http on a platform that does not allow it', () => {
        const res = validateRouteServerUrl('http://192.168.1.20', { allowsLocalHttp: false })
        expect(res).toMatchObject({
            valid: false, code: 'http-not-supported',
            message: "This device can't use servers without https:// yet. Use an https:// address."
        })
    })
    test('home-network http is refused by default (no capability)', () => {
        expect(validateRouteServerUrl('http://192.168.1.20')).toMatchObject({ valid: false, code: 'http-not-supported' })
    })
    test('https on the home network is fine without the capability', () => {
        expect(validateRouteServerUrl('https://192.168.1.20', { allowsLocalHttp: false }).valid).toBe(true)
    })

    test('U11 duplicate after normalising', () => {
        const res = validateRouteServerUrl('HTTPS://Videos.Example.org:443/', { existingServers: { 'Alpine Videos': 'https://videos.example.org' } })
        expect(res).toMatchObject({ valid: false, code: 'duplicate', message: "You've already added this server as 'Alpine Videos'." })
    })
    test('http and https of the same host are different servers', () => {
        const res = validateRouteServerUrl('https://nas', { existingServers: { Nas: 'http://nas' }, allowsLocalHttp: true })
        expect(res.valid).toBe(true)
    })
    test('the built-in server is refused', () => {
        const res = validateRouteServerUrl('https://dlws.incyclist.com/api/v1/routes/', { builtInUrls: ['https://dlws.incyclist.com/api/v1/routes'] })
        expect(res).toMatchObject({ valid: false, code: 'built-in', message: "This is Incyclist's own server. It's already included." })
    })
    test('the length limit also applies to the normalised address', () => {
        // short as typed, longer once non-ASCII characters of the path are percent-encoded
        const input = `https://videos.example.org/${'ü'.repeat(700)}`
        expect(input.length).toBeLessThan(2048)
        expect(validateRouteServerUrl(input)).toMatchObject({ valid: false, code: 'not-a-url' })
    })
    test('query string message', () => {
        expect(validateRouteServerUrl('https://videos.example.org/?a=1').message).toContain("can't contain a query string")
    })
    test('not a url', () => {
        expect(validateRouteServerUrl('https://exa mple')).toMatchObject({ valid: false, code: 'whitespace' })
        expect(validateRouteServerUrl('https://[bad')).toMatchObject({ valid: false, code: 'not-a-url' })
    })
})

describe('isHomeNetworkHost', () => {
    test('raw host differing from the parsed host is the internet', () => {
        expect(isHomeNetworkHost('127.1', '127.0.0.1')).toBe(false)
    })
})

describe('normalizeRouteServerUrl', () => {
    test('drops default port, trailing slash and case of host', () => {
        expect(normalizeRouteServerUrl('HTTPS://Videos.Example.org:443/')).toBe('https://videos.example.org')
    })
    test('keeps the path', () => {
        expect(normalizeRouteServerUrl('https://a.org/api/v1/routes/')).toBe('https://a.org/api/v1/routes')
    })
    test('many trailing slashes are dropped', () => {
        expect(normalizeRouteServerUrl(`https://a.org/api${'/'.repeat(5000)}`)).toBe('https://a.org/api')
        expect(normalizeRouteServerUrl(`Not A Url${'/'.repeat(5000)}`)).toBe('not a url')
    })
    test('unparsable input falls back to a lower case string', () => {
        expect(normalizeRouteServerUrl('Not A Url/')).toBe('not a url')
    })
})

describe('isAllowedRedirectTarget', () => {
    const internet = 'https://videos.example.org/api/v1/routes/?type=video'
    const home = 'http://nas:8080/api/?type=video'

    test('https to the internet is allowed', () => {
        expect(isAllowedRedirectTarget('https://other.example.org/api/?type=video', internet)).toBe(true)
    })
    test('the query string of the target is ignored', () => {
        expect(isAllowedRedirectTarget('https://other.example.org/api?type=video&x=1', internet)).toBe(true)
    })
    test('https downgrade to http on the internet is not allowed', () => {
        expect(isAllowedRedirectTarget('http://videos.example.org/api', internet)).toBe(false)
    })
    test('internet to home-network http is not allowed', () => {
        expect(isAllowedRedirectTarget('http://192.168.1.20/api', internet)).toBe(false)
    })
    test('internet to home-network https is not allowed', () => {
        expect(isAllowedRedirectTarget('https://192.168.1.20/api', internet)).toBe(false)
        expect(isAllowedRedirectTarget('https://nas/api', internet)).toBe(false)
        expect(isAllowedRedirectTarget('https://localhost/api', internet)).toBe(false)
    })
    test('home network to home network is allowed, also over http', () => {
        expect(isAllowedRedirectTarget('http://nas:8080/other/', home)).toBe(true)
        expect(isAllowedRedirectTarget('http://192.168.1.20/api', home)).toBe(true)
    })
    test('home network to https on the internet is allowed', () => {
        expect(isAllowedRedirectTarget('https://videos.example.org/api', home)).toBe(true)
    })
    test('home network to http on the internet is not allowed', () => {
        expect(isAllowedRedirectTarget('http://videos.example.org/api', home)).toBe(false)
    })
    test('an origin that is not a valid address counts as the internet', () => {
        expect(isAllowedRedirectTarget('http://nas:8080/api', 'not a url')).toBe(false)
    })
    test('a target that is not a valid address is not allowed', () => {
        expect(isAllowedRedirectTarget('ftp://nas/api', home)).toBe(false)
        expect(isAllowedRedirectTarget('nonsense', home)).toBe(false)
    })
})

describe('toSourceLabel', () => {
    test.each([
        ['Ebeling Hoppe', 'EbelingHoppe'],
        ['alpine-videos', 'AlpineVideos'],
        ['AlpineVideos', 'AlpineVideos'],
        ['strava', 'Strava'],
    ])('%s is shown as %s', (name, label) => {
        expect(toSourceLabel(name)).toBe(label)
    })
    test('empty', () => {
        expect(toSourceLabel('')).toBe('')
    })
})
