import { getKnownRouteServers } from './known'
import { normalizeRouteServerUrl, validateRouteServerName, validateRouteServerUrl } from './validator'

describe('known route servers', () => {

    test('K1 every entry passes the name and URL rules', () => {
        const servers = getKnownRouteServers()
        expect(Array.isArray(servers)).toBe(true)

        for (const server of servers) {
            const name = validateRouteServerName(server.name, { reservedNames: ['Strava', 'Komoot', 'Intervals', 'TrainerDay', 'RideWithGPS', 'TrainingPeaks'] })
            expect(name).toMatchObject({ valid: true })
            if (name.valid)
                expect(name.name).toBe(server.name)

            // bundled entries are internet servers: https only, no home-network http
            const url = validateRouteServerUrl(server.url, { allowsLocalHttp: false })
            expect(url).toMatchObject({ valid: true, isUnencrypted: false })
            expect(server.description?.length).toBeGreaterThan(0)
        }
    })

    test('K1 ids, names and normalised urls are unique', () => {
        const servers = getKnownRouteServers()
        const unique = (values: Array<string>) => new Set(values).size === values.length

        expect(unique(servers.map(s => s.id))).toBe(true)
        expect(unique(servers.map(s => s.name.toLowerCase()))).toBe(true)
        expect(unique(servers.map(s => normalizeRouteServerUrl(s.url)))).toBe(true)
    })

    test('returns copies, so callers can not change the bundled list', () => {
        const a = getKnownRouteServers()
        a.push({ id: 'x', name: 'x', url: 'https://x.org', description: 'x' })
        expect(getKnownRouteServers()).not.toContainEqual(expect.objectContaining({ id: 'x' }))
    })
})
