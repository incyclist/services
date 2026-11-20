import { EventLogger } from 'gd-eventlog'
import { Inject } from '../../../base/decorators'
import { RouteServerValidationError } from '../../../routes/servers/errors'
import { RouteServerStatusStore, useRouteServerStatus } from '../../../routes/servers/status'
import { validateRouteServerName, validateRouteServerUrl } from '../../../routes/servers/validator'
import type { KnownRouteServer, RouteServerProbeResult } from '../../../routes/servers/types'
import { RouteServersSettingsDisplayService, useRouteServersSettingsDisplay } from './service'
import type { RouteServersSettingsDisplayProps } from './types'

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

const KNOWN: Array<KnownRouteServer> = [
    { id: 'alpine', name: 'Alpine Videos', url: 'https://alpine.example.org/api/v1/routes', description: 'Alps & Dolomites', operator: 'Alpine Video Club' },
    { id: 'flanders', name: 'Flanders Classics', url: 'https://flanders.example.org/routes', description: 'Cobbles and bergs' },
]

describe('RouteServersSettingsDisplayService', () => {
    let service: RouteServersSettingsDisplayService
    let status: RouteServerStatusStore
    let servers: Map<string, string>
    let counts: Record<string, number>
    let list
    let known: Array<KnownRouteServer>
    let observer
    let updates: jest.Mock

    const setPlatform = (channel: string, platform: string | undefined) => {
        Inject('Bindings', { appInfo: { getChannel: jest.fn().mockReturnValue(channel), getOS: jest.fn().mockReturnValue({ platform }) } })
    }

    const probeOk = (routeCount: number, url?: string, switchedToHttp?: boolean) =>
        (u: string): Promise<RouteServerProbeResult> => Promise.resolve({ ok: true, routeCount, url: url ?? u, switchedToHttp })
    const probeFail = (code: 'unreachable' | 'not-a-server' | 'server-error', message: string) =>
        (u: string): Promise<RouteServerProbeResult> => Promise.resolve({ ok: false, code, message, url: u })

    const props = (): RouteServersSettingsDisplayProps => service.getDisplayProps()

    const createList = () => {
        const nameContext = () => ({ existingNames: Array.from(servers.keys()), reservedNames: ['Local', 'Incyclist', 'strava', 'Strava'] })
        const urlContext = (p) => ({ ...p, existingServers: Object.fromEntries(servers), builtInUrls: ['https://dlws.incyclist.com/api/v1/routes'] })
        return {
            getExternalApiProviders: jest.fn(() => servers.size ? new Map(servers) : null),
            validateExternalApiProviderName: jest.fn((n: string) => validateRouteServerName(n, nameContext())),
            validateExternalApiProviderUrl: jest.fn((u: string, p) => validateRouteServerUrl(u, urlContext(p ?? {}))),
            probeExternalApiProvider: jest.fn(probeOk(3)),
            addExternalApiProvider: jest.fn((key: string, url: string) => {
                const name = validateRouteServerName(key, nameContext())
                if (!name.valid) throw new RouteServerValidationError('name', name.code, name.message)
                const address = validateRouteServerUrl(url, urlContext({ allowsLocalHttp: true }))
                if (!address.valid) throw new RouteServerValidationError('url', address.code, address.message)
                servers.set(name.name, address.url)
                return { name: name.name, url: address.url }
            }),
            deleteExternalApiProvider: jest.fn((key: string) => { servers.delete(key) }),
            loadExternalApiProvider: jest.fn().mockResolvedValue(undefined),
            getExternalApiProviderRouteCount: jest.fn((key: string) => counts[key] ?? 0),
            getExternalApiProviderDownloadInfo: jest.fn().mockResolvedValue({ routeCount: 0, downloadedCount: 0, downloadedBytes: 0 }),
            deleteExternalApiProviderRoutes: jest.fn().mockResolvedValue({ deleted: 0, failed: 0 }),
        }
    }

    beforeEach(() => {
        jest.spyOn(EventLogger.prototype, 'logEvent').mockImplementation()
        servers = new Map()
        counts = {}
        known = []
        list = createList()
        status = useRouteServerStatus()
        Inject('RouteList', list)
        Inject('KnownServers', undefined)
        setPlatform('desktop', 'linux')
        service = new RouteServersSettingsDisplayService()
        ;(service as unknown as { getKnownServers: () => Array<KnownRouteServer> }).getKnownServers = () => known
        observer = service.open('settings')
        updates = jest.fn()
        observer.on('changed', updates)
    })

    afterEach(() => {
        service.close()
        status.reset()
        Inject('RouteList', null)
        Inject('Bindings', null)
        jest.useRealTimers()
        jest.restoreAllMocks()
    })

    test('the hook returns the singleton, so the state of an open dialog survives between calls', () => {
        expect(useRouteServersSettingsDisplay()).toBe(service)
    })

    describe('open / close', () => {
        test('settings: starts with the list', () => {
            expect(props()).toMatchObject({ view: 'list', origin: 'settings' })
        })

        test('import: starts with the add view', () => {
            service.open('import')
            expect(props()).toMatchObject({ view: 'add', origin: 'import' })
        })

        test('opening again resets everything', () => {
            service.showAdd()
            service.setManualUrl('foo.example.org')
            service.open('settings')
            expect(props().view).toBe('list')
            expect(props().manual.url).toBe('')
        })

        test('close stops the observer and emits closed with the reason cancel', () => {
            const closed = jest.fn()
            observer.on('closed', closed)
            service.close()
            expect(closed).toHaveBeenCalledWith({ reason: 'cancel' })
            expect(service.getObserver()).toBeUndefined()
        })

        test('opening the dialog again closes the previous one with the reason cancel', () => {
            const closed = jest.fn()
            observer.on('closed', closed)
            service.open('import')
            expect(closed).toHaveBeenCalledWith({ reason: 'cancel' })
        })
    })

    describe('list', () => {
        test('no user servers: built-in row only, empty state, trust note', () => {
            const p = props()
            expect(p.servers).toEqual([{ key: 'Incyclist', name: 'Incyclist', isBuiltIn: true, status: 'ok', statusText: 'Built in', canRemove: false }])
            expect(p.isEmpty).toBe(true)
            expect(p.emptyState?.title).toBe('Get more routes from other providers')
            expect(p.trustNote).toContain('Only add servers you trust')
            expect(p.known).toEqual([])
            expect(p.knownNote).toBeUndefined()
        })

        test('user servers are listed by name after the built-in server', () => {
            servers.set('Zeta', 'https://zeta.example.org/')
            servers.set('alpine Videos', 'https://alpine.example.org/api')
            counts['Zeta'] = 1
            counts['alpine Videos'] = 24

            const p = props()

            expect(p.isEmpty).toBe(false)
            expect(p.emptyState).toBeUndefined()
            expect(p.servers.map(s => s.name)).toEqual(['Incyclist', 'alpine Videos', 'Zeta'])
            expect(p.servers[1]).toMatchObject({ host: 'alpine.example.org', isBuiltIn: false, canRemove: true, status: 'unknown', routeCount: 24, statusText: '24 routes' })
            expect(p.servers[2].statusText).toBe('1 route')
        })

        test('status unknown with no routes: neutral text, no amber', () => {
            servers.set('Alpine', 'https://alpine.example.org/')
            expect(props().servers[1]).toMatchObject({ status: 'unknown', statusText: 'No routes yet' })
        })

        test('statuses of the last load', () => {
            servers.set('A', 'https://a.example.org/')
            servers.set('B', 'https://b.example.org/')
            servers.set('C', 'https://c.example.org/')
            servers.set('D', 'https://d.example.org/')
            counts['A'] = 5
            status.setResult('A', { status: 'ok', routeCount: 20 })
            status.setResult('B', { status: 'empty', routeCount: 0 })
            status.setResult('C', { status: 'unreachable', routeCount: 0 })
            status.setLoading('D')

            const [, a, b, c, d] = props().servers

            expect(a).toMatchObject({ status: 'ok', statusText: '5 routes' })
            expect(b).toMatchObject({ status: 'empty', statusText: 'No routes yet' })
            expect(c).toMatchObject({ status: 'unreachable', statusText: "Couldn't be reached last time. Routes you already have still work." })
            expect(d).toMatchObject({ status: 'loading', statusText: 'Checking…' })
        })

        test('unreachable server keeps showing the routes it has in the list', () => {
            servers.set('A', 'https://a.example.org/')
            counts['A'] = 4
            status.setResult('A', { status: 'unreachable', routeCount: 0 })
            expect(props().servers[1]).toMatchObject({ status: 'unreachable', routeCount: 4 })
        })

        test('changed is emitted when a status changes', () => {
            status.setLoading('A')
            expect(updates).toHaveBeenCalled()
        })

        test('home-network servers get a tag', () => {
            servers.set('Nas', 'http://nas:8080/')
            servers.set('Secure Nas', 'https://192.168.1.20/')
            const [, nas, secure] = props().servers
            expect(nas).toMatchObject({ isLocal: true, isUnencrypted: true, tag: 'Local · not encrypted' })
            expect(secure).toMatchObject({ isLocal: true, isUnencrypted: false, tag: 'Local' })
            expect(nas.addedOutsideApp).toBeUndefined()
        })

        test('config-file entries that the app would refuse are marked', () => {
            servers.set('Web Http', 'http://videos.example.org/')
            servers.set('a.b', 'https://videos2.example.org/')
            const [, a, b] = props().servers
            expect(a).toMatchObject({ addedOutsideApp: true, note: 'Added outside the app' })
            expect(b).toMatchObject({ addedOutsideApp: true })
        })

        test('home-network http on a platform that does not allow it counts as added outside the app', () => {
            setPlatform('mobile', 'android')
            servers.set('Nas', 'http://nas:8080/')
            expect(props().servers[1].addedOutsideApp).toBe(true)
        })
    })

    describe('navigation', () => {
        test('showAdd / back from settings: add view, then list', () => {
            service.showAdd()
            expect(props().view).toBe('add')
            service.back()
            expect(props().view).toBe('list')
        })

        test('back in the list closes with the reason back', () => {
            const closed = jest.fn()
            observer.on('closed', closed)
            service.back()
            expect(closed).toHaveBeenCalledWith({ reason: 'back' })
        })

        test('import origin: back in the add view closes with the reason back', () => {
            const closed = jest.fn()
            observer = service.open('import')
            observer.on('closed', closed)
            service.back()
            expect(closed).toHaveBeenCalledWith({ reason: 'back' })
        })

        test('phone: manual entry is the second step, back returns to the known list', () => {
            service.showAdd()
            service.showManualEntry()
            expect(props().view).toBe('add-manual')
            service.back()
            expect(props().view).toBe('add')
        })

        test('showAdd starts with an empty form', () => {
            service.showAdd()
            service.setManualUrl('foo.example.org')
            service.back()
            service.showAdd()
            expect(props().manual).toMatchObject({ url: '', name: '', state: 'idle' })
        })
    })

    describe('known servers', () => {
        beforeEach(() => { known = KNOWN })

        test('listed with the note, available', () => {
            const p = props()
            expect(p.known).toEqual([
                { id: 'alpine', name: 'Alpine Videos', description: 'Alps & Dolomites', operator: 'Alpine Video Club', state: 'available' },
                { id: 'flanders', name: 'Flanders Classics', description: 'Cobbles and bergs', state: 'available' },
            ])
            expect(p.knownNote).toBe('Listed servers were checked to work with Incyclist. Their content comes from their operators.')
        })

        test('an entry whose url is already configured shows as added, matched by normalised url', () => {
            servers.set('My Alpine', 'https://ALPINE.example.org/api/v1/routes/')
            counts['My Alpine'] = 12
            expect(props().known[0]).toMatchObject({ id: 'alpine', state: 'added', routeCount: 12 })
            expect(props().known[1].state).toBe('available')
        })

        test('addKnown: checks, adds under the listed name without asking for a name, starts loading', async () => {
            service.addKnown('alpine')
            expect(props().known[0].state).toBe('checking')
            await flush()

            expect(list.probeExternalApiProvider).toHaveBeenCalledWith('https://alpine.example.org/api/v1/routes')
            expect(list.addExternalApiProvider).toHaveBeenCalledWith('Alpine Videos', 'https://alpine.example.org/api/v1/routes', { origin: 'settings', via: 'known' })
            expect(list.loadExternalApiProvider).toHaveBeenCalledWith('Alpine Videos')
            // the count of routes that were added is only known once they are in the list
            expect(props().known[0].state).toBe('added')
            expect(props().known[0].routeCount).toBeUndefined()
            expect(status.getStatus('Alpine Videos')).toBe('loading')

            counts['Alpine Videos'] = 3
            expect(props().known[0]).toMatchObject({ state: 'added', routeCount: 3 })
        })

        test('addKnown with a failing check: inline error, retry works', async () => {
            list.probeExternalApiProvider.mockImplementation(probeFail('unreachable', "Couldn't reach this address. Check it, and check that you're online."))
            service.addKnown('alpine')
            await flush()

            expect(props().known[0]).toMatchObject({ state: 'error', error: "Couldn't reach this address. Check it, and check that you're online." })
            expect(servers.size).toBe(0)

            list.probeExternalApiProvider.mockImplementation(probeOk(7))
            service.retryKnown('alpine')
            await flush()

            expect(props().known[0].state).toBe('added')
        })

        test('counts the routes in the list, not the routes the server offers (duplicates are skipped)', async () => {
            list.probeExternalApiProvider.mockImplementation(probeOk(20))
            service.addKnown('alpine')
            await flush()

            counts['Alpine Videos'] = 7
            status.setResult('Alpine Videos', { status: 'ok', routeCount: 20 })
            expect(props().known[0]).toMatchObject({ state: 'added', routeCount: 7 })
            expect(props().servers.find(s => s.name === 'Alpine Videos')).toMatchObject({ routeCount: 7, statusText: '7 routes' })
        })

        test('name already used by another server: error inline in the row', async () => {
            servers.set('alpine-videos', 'https://other.example.org/')
            service.addKnown('alpine')
            await flush()

            expect(props().known[0].state).toBe('error')
            expect(props().known[0].error).toContain("You already have a server called 'alpine-videos'")
            expect(list.probeExternalApiProvider).not.toHaveBeenCalled()
        })

        test('an entry that is added already is not added again; unknown id is ignored', async () => {
            servers.set('Alpine Videos', 'https://alpine.example.org/api/v1/routes')
            service.addKnown('alpine')
            service.addKnown('nope')
            await flush()
            expect(list.probeExternalApiProvider).not.toHaveBeenCalled()
        })

        test('leaving the add view while a check runs: the result is dropped', async () => {
            let finish
            list.probeExternalApiProvider.mockImplementation(() => new Promise(r => { finish = r }))
            service.showAdd()
            service.addKnown('alpine')
            service.back()
            finish({ ok: true, routeCount: 1, url: 'https://alpine.example.org/api/v1/routes' })
            await flush()
            expect(servers.size).toBe(0)
        })

        test('statusText of known servers: ready to render', async () => {
            service.addKnown('alpine')
            expect(props().known[0].statusText).toBe('Checking…')
            expect(props().known[1].statusText).toBeUndefined()
            await flush()

            expect(props().known[0].statusText).toBe('Added ✓')
            counts['Alpine Videos'] = 7
            expect(props().known[0].statusText).toBe('Added ✓ · 7 routes')
            counts['Alpine Videos'] = 1
            expect(props().known[0].statusText).toBe('Added ✓ · 1 route')
        })

        test('settings origin: the view stays where it is, the new row is highlighted', async () => {
            jest.useFakeTimers()
            const closed = jest.fn()
            observer.on('closed', closed)
            service.showAdd()
            service.addKnown('alpine')
            await flush()
            jest.advanceTimersByTime(2000)

            expect(closed).not.toHaveBeenCalled()
            expect(props()).toMatchObject({ view: 'add', highlightKey: 'Alpine Videos' })
        })

        test('the highlight is cleared after 3 seconds and the display props are updated', async () => {
            jest.useFakeTimers()
            service.showAdd()
            service.addKnown('alpine')
            await flush()
            updates.mockClear()

            jest.advanceTimersByTime(2900)
            expect(props().highlightKey).toBe('Alpine Videos')
            jest.advanceTimersByTime(200)

            expect(props().highlightKey).toBeUndefined()
            expect(updates).toHaveBeenCalled()
        })

        test('closing cancels the highlight timer', async () => {
            jest.useFakeTimers()
            service.showAdd()
            service.addKnown('alpine')
            await flush()

            service.close()

            expect(jest.getTimerCount()).toBe(0)
        })

        test('import origin: closes with done after the success was shown, like a manual add', async () => {
            jest.useFakeTimers()
            const closed = jest.fn()
            observer = service.open('import')
            observer.on('closed', closed)

            service.addKnown('alpine')
            await flush()

            expect(props().known[0].state).toBe('added')
            expect(list.addExternalApiProvider).toHaveBeenCalledWith('Alpine Videos', expect.any(String), { origin: 'import', via: 'known' })
            expect(closed).not.toHaveBeenCalled()
            jest.advanceTimersByTime(999)
            expect(closed).not.toHaveBeenCalled()
            jest.advanceTimersByTime(1)
            expect(closed).toHaveBeenCalledTimes(1)
            expect(closed).toHaveBeenCalledWith({ reason: 'done' })
        })

        test('import origin: going back before the confirmation ends does not close a second time', async () => {
            jest.useFakeTimers()
            const closed = jest.fn()
            observer = service.open('import')
            observer.on('closed', closed)
            service.addKnown('alpine')
            await flush()

            service.back()
            jest.advanceTimersByTime(2000)

            expect(closed).toHaveBeenCalledTimes(1)
            expect(closed).toHaveBeenCalledWith({ reason: 'back' })
        })

        test('import origin: a failing check does not close', async () => {
            jest.useFakeTimers()
            const closed = jest.fn()
            observer = service.open('import')
            observer.on('closed', closed)
            list.probeExternalApiProvider.mockImplementation(probeFail('unreachable', 'nope'))

            service.addKnown('alpine')
            await flush()
            jest.advanceTimersByTime(5000)

            expect(closed).not.toHaveBeenCalled()
        })

        test('a failing add (server side validation) shows the message', async () => {
            list.addExternalApiProvider.mockImplementation(() => { throw new RouteServerValidationError('url', 'duplicate', "You've already added this server as 'X'.") })
            service.addKnown('alpine')
            await flush()
            expect(props().known[0]).toMatchObject({ state: 'error', error: "You've already added this server as 'X'." })
        })
    })

    describe('manual entry', () => {
        beforeEach(() => { service.showAdd() })

        describe('name suggestion', () => {
            test('is offered from the host while the name was not touched', () => {
                service.setManualUrl('videos.alpine-club.org')
                expect(props().manual).toMatchObject({ name: 'Alpine Club', suggestedName: 'Alpine Club', nameTouched: false })
            })

            test('N17: an IP address gives no suggestion; button stays disabled until a name is typed', () => {
                service.setManualUrl('http://192.168.1.20')
                const m = props().manual
                expect(m.name).toBe('')
                expect(m.suggestedName).toBeUndefined()
                expect(m.canSubmit).toBe(false)
                expect(m.canCheck).toBe(true)
                expect(m.nameError).toBeUndefined()
            })

            test('N18: an edited name is kept when the address changes later', () => {
                service.setManualUrl('videos.alpine-club.org')
                service.setManualName('Alps')
                service.setManualUrl('videos.other-club.org')
                expect(props().manual).toMatchObject({ name: 'Alps', nameTouched: true, suggestedName: 'Other Club' })
            })

            test('a suggestion that fails the name rules is not offered', () => {
                service.setManualUrl('videos.strava.org')   // "Strava" is a reserved source
                expect(props().manual.suggestedName).toBeUndefined()
                expect(props().manual.name).toBe('')
            })

            test('suggestion follows the address while untouched, and goes away when the address does not parse', () => {
                service.setManualUrl('videos.alpine-club.org')
                service.setManualUrl('http://')
                expect(props().manual.name).toBe('')
            })
        })

        describe('live feedback', () => {
            test('http on the home network: note, not an error', () => {
                service.setManualUrl('http://nas:8080')
                expect(props().manual.localNote).toBe("Local server — traffic isn't encrypted. Use this only on your home network.")
                expect(props().manual.urlError).toBeUndefined()
            })

            test('http on the internet: error while typing', () => {
                service.setManualUrl('http://videos.example.org')
                expect(props().manual.urlError).toContain('Plain http:// only works for servers on your home network')
            })

            test('a query string is reported', () => {
                service.setManualUrl('https://videos.example.org/api?type=video')
                expect(props().manual.urlError).toContain("can't contain a query string")
            })

            test('whitespace and credentials are reported', () => {
                service.setManualUrl('https://a.example.org/a b')
                expect(props().manual.urlError).toContain("can't contain spaces")
                service.setManualUrl('https://user:pw@a.example.org')
                expect(props().manual.urlError).toContain('user name or password')
            })

            test('an incomplete address is not reported while typing', () => {
                service.setManualUrl('htt')
                expect(props().manual.urlError).toBeUndefined()
            })

            test('already added server', () => {
                servers.set('Alpine Videos', 'https://videos.example.org')
                service.setManualUrl('HTTPS://Videos.Example.org:443/')
                expect(props().manual.urlError).toBe("You've already added this server as 'Alpine Videos'.")
            })

            test('name errors: shown once typed; empty name only after the user touched the field', () => {
                service.setManualUrl('http://192.168.1.20')
                expect(props().manual.nameError).toBeUndefined()

                service.setManualName('')
                expect(props().manual.nameError).toBe("Enter a name. It's shown in your route list.")

                service.setManualName('a.b')
                expect(props().manual.nameError).toBe('Use up to 24 letters, numbers, spaces or dashes.')

                service.setManualName('strava')
                expect(props().manual.nameError).toBe("'strava' is already used as a source in Incyclist. Choose another name.")

                service.setManualName('constructor')
                expect(props().manual.nameError).toBe("This name can't be used. Choose another name.")

                service.setManualName('All')
                expect(props().manual.nameError).toBe("This name can't be used. Choose another name.")

                servers.set('Alpine Videos', 'https://x.example.org')
                service.setManualName('alpine-videos')
                expect(props().manual.nameError).toBe("You already have a server called 'Alpine Videos'. Choose another name.")

                service.setManualName('Fine')
                expect(props().manual.nameError).toBeUndefined()
            })

            test('changed is emitted on input', () => {
                updates.mockClear()
                service.setManualUrl('a.example.org')
                service.setManualName('A')
                expect(updates).toHaveBeenCalledTimes(2)
            })
        })

        describe('canSubmit / canCheck', () => {
            test('empty address: nothing enabled', () => {
                expect(props().manual).toMatchObject({ canSubmit: false, canCheck: false })
            })

            test('N16: valid address, empty name: check possible, submit not', () => {
                service.setManualUrl('http://192.168.1.20')
                expect(props().manual).toMatchObject({ canSubmit: false, canCheck: true })
            })

            test('address and valid name: submit enabled', () => {
                service.setManualUrl('videos.alpine-club.org')
                expect(props().manual).toMatchObject({ canSubmit: true, canCheck: true })
            })

            test('invalid name: submit disabled', () => {
                service.setManualUrl('videos.alpine-club.org')
                service.setManualName('a.b')
                expect(props().manual.canSubmit).toBe(false)
            })
        })

        describe('checkAndAdd (one step)', () => {
            test('success: checked, saved, loading starts, view returns to the list after a moment', async () => {
                jest.useFakeTimers()
                service.setManualUrl('videos.alpine-club.org')

                service.checkAndAdd()
                expect(props().manual.state).toBe('checking')
                await flush()

                expect(list.probeExternalApiProvider).toHaveBeenCalledWith('https://videos.alpine-club.org/', undefined)
                expect(list.addExternalApiProvider).toHaveBeenCalledWith('Alpine Club', 'https://videos.alpine-club.org/', { origin: 'settings', via: 'manual' })
                expect(props().manual).toMatchObject({ state: 'success', message: 'Found 3 routes.' })
                expect(props().highlightKey).toBe('Alpine Club')
                expect(list.loadExternalApiProvider).toHaveBeenCalledWith('Alpine Club')
                expect(status.getStatus('Alpine Club')).toBe('loading')
                expect(props().view).toBe('add')

                jest.advanceTimersByTime(1000)
                expect(props().view).toBe('list')
                expect(props().highlightKey).toBe('Alpine Club')
                expect(props().servers.map(s => s.name)).toContain('Alpine Club')
            })

            test('opened from the import dialog: closes after the confirmation', async () => {
                jest.useFakeTimers()
                const closed = jest.fn()
                observer = service.open('import')
                observer.on('closed', closed)
                service.setManualUrl('videos.alpine-club.org')
                service.checkAndAdd()
                await flush()
                expect(closed).not.toHaveBeenCalled()
                jest.advanceTimersByTime(1000)
                expect(closed).toHaveBeenCalledTimes(1)
                expect(closed).toHaveBeenCalledWith({ reason: 'done' })
            })

            test('name is checked before the address is probed', () => {
                service.setManualUrl('http://192.168.1.20')
                service.checkAndAdd()
                expect(list.probeExternalApiProvider).not.toHaveBeenCalled()
                expect(props().manual).toMatchObject({ state: 'error', nameError: "Enter a name. It's shown in your route list." })
            })

            test('invalid address: error below the address, no probe', () => {
                service.setManualUrl('not a url')
                service.setManualName('X')
                service.checkAndAdd()
                expect(list.probeExternalApiProvider).not.toHaveBeenCalled()
                expect(props().manual).toMatchObject({ state: 'error' })
                expect(props().manual.urlError).toContain("can't contain spaces")
            })

            test('unparsable address: "doesn\'t look like a web address"', () => {
                service.setManualUrl('https://[bad')
                service.setManualName('X')
                service.checkAndAdd()
                expect(props().manual.urlError).toBe("This doesn't look like a web address. Check for typos.")
            })

            test.each([
                ['unreachable', "Couldn't reach this address. Check it, and check that you're online."],
                ['not-a-server', "This address answered, but it isn't a route server. Check you copied the full address."],
                ['server-error', "The server didn't respond properly. Try again later, or ask its operator."],
            ] as const)('probe failure %s: error with the user message, nothing saved', async (code, message) => {
                list.probeExternalApiProvider.mockImplementation(probeFail(code, message))
                service.setManualUrl('videos.alpine-club.org')
                service.checkAndAdd()
                await flush()

                expect(props().manual).toMatchObject({ state: 'error', urlError: message })
                expect(servers.size).toBe(0)
            })

            test('editing after an error returns to idle and clears the error', async () => {
                list.probeExternalApiProvider.mockImplementation(probeFail('unreachable', 'x'))
                service.setManualUrl('videos.alpine-club.org')
                service.checkAndAdd()
                await flush()
                service.setManualUrl('videos.alpine-club.org/api')
                expect(props().manual).toMatchObject({ state: 'idle' })
                expect(props().manual.urlError).toBeUndefined()
            })

            test('0 routes: asks for confirmation, Add anyway saves', async () => {
                list.probeExternalApiProvider.mockImplementation(probeOk(0))
                service.setManualUrl('videos.alpine-club.org')
                service.checkAndAdd()
                await flush()

                expect(props().manual).toMatchObject({ state: 'confirm-empty', message: 'This server works but has no routes yet. Add it anyway?' })
                expect(servers.size).toBe(0)

                service.confirmAddEmpty()
                expect(props().manual.state).toBe('success')
                expect(servers.has('Alpine Club')).toBe(true)
            })

            test('0 routes: cancelAddEmpty returns to the entry, keeps address and name, leaves no probe state behind', async () => {
                list.probeExternalApiProvider.mockImplementation(probeOk(0))
                service.setManualUrl('http://192.168.1.20')
                service.setManualName('My NAS')
                service.checkAndAdd()
                await flush()
                expect(props().manual.state).toBe('confirm-empty')

                service.cancelAddEmpty()

                const manual = props().manual
                expect(manual).toMatchObject({ state: 'idle', url: 'http://192.168.1.20', name: 'My NAS', nameTouched: true, canSubmit: true, canCheck: true })
                expect(manual.message).toBeUndefined()
                expect(manual.resolvedUrl).toBeUndefined()
                expect(manual.urlError).toBeUndefined()
                expect(manual.localNote).toBe("Local server — traffic isn't encrypted. Use this only on your home network.")
                expect(servers.size).toBe(0)
                expect(updates).toHaveBeenCalled()

                // nothing is pending any more
                service.confirmAddEmpty()
                service.add()
                expect(servers.size).toBe(0)
            })

            test('cancelAddEmpty outside of confirm-empty does nothing', () => {
                service.setManualUrl('videos.alpine-club.org')
                service.cancelAddEmpty()
                expect(props().manual).toMatchObject({ state: 'idle', url: 'videos.alpine-club.org' })
            })

            test('cancelAddEmpty: the user can edit and check again', async () => {
                list.probeExternalApiProvider.mockImplementation(probeOk(0))
                service.setManualUrl('videos.alpine-club.org')
                service.checkAndAdd()
                await flush()
                service.cancelAddEmpty()

                list.probeExternalApiProvider.mockImplementation(probeOk(4))
                service.checkAndAdd()
                await flush()

                expect(servers.has('Alpine Club')).toBe(true)
            })

            test('0 routes: Cancel (back) saves nothing', async () => {
                list.probeExternalApiProvider.mockImplementation(probeOk(0))
                service.setManualUrl('videos.alpine-club.org')
                service.checkAndAdd()
                await flush()
                service.back()
                expect(servers.size).toBe(0)
            })

            test('switch to http: stops at checked with the resolved address, saved only with add()', async () => {
                list.probeExternalApiProvider.mockImplementation(probeOk(5, 'http://nas:8080/', true))
                service.setManualUrl('nas:8080')
                service.checkAndAdd()
                await flush()

                expect(list.probeExternalApiProvider).toHaveBeenCalledWith('https://nas:8080/', 'http://nas:8080/')
                expect(props().manual).toMatchObject({
                    state: 'checked', resolvedUrl: 'http://nas:8080/', message: 'Found 5 routes.',
                    localNote: "Local server — traffic isn't encrypted.", name: 'Nas', canSubmit: true
                })
                expect(servers.size).toBe(0)

                service.add()
                expect(servers.get('Nas')).toBe('http://nas:8080/')
                expect(props().manual.state).toBe('success')
            })

            test('no http fallback is offered if the platform does not allow it', async () => {
                setPlatform('mobile', 'android')
                service.setManualUrl('nas:8080')
                service.checkAndAdd()
                await flush()
                expect(list.probeExternalApiProvider).toHaveBeenCalledWith('https://nas:8080/', undefined)
            })

            test('home-network http on a platform that does not allow it', () => {
                setPlatform('mobile', 'android')
                service.setManualUrl('http://192.168.1.20')
                expect(props().manual.urlError).toBe("This device can't use servers without https:// yet. Use an https:// address.")
            })

            test('back while checking: result is dropped', async () => {
                let finish
                list.probeExternalApiProvider.mockImplementation(() => new Promise(r => { finish = r }))
                service.setManualUrl('videos.alpine-club.org')
                service.checkAndAdd()
                service.back()
                finish({ ok: true, routeCount: 2, url: 'https://videos.alpine-club.org/' })
                await flush()
                expect(servers.size).toBe(0)
            })

            test('a second call while checking is ignored', async () => {
                service.setManualUrl('videos.alpine-club.org')
                service.checkAndAdd()
                service.checkAndAdd()
                await flush()
                expect(list.probeExternalApiProvider).toHaveBeenCalledTimes(1)
            })

            test('saving fails in the service (name): error below the name', async () => {
                list.addExternalApiProvider.mockImplementation(() => { throw new RouteServerValidationError('name', 'duplicate', 'You already have a server called X.') })
                service.setManualUrl('videos.alpine-club.org')
                service.checkAndAdd()
                await flush()
                expect(props().manual).toMatchObject({ state: 'error', nameError: 'You already have a server called X.' })
            })

            test('saving fails in the service (url): error below the address', async () => {
                list.addExternalApiProvider.mockImplementation(() => { throw new RouteServerValidationError('url', 'duplicate', "You've already added this server as 'X'.") })
                service.setManualUrl('videos.alpine-club.org')
                service.checkAndAdd()
                await flush()
                expect(props().manual).toMatchObject({ state: 'error', urlError: "You've already added this server as 'X'." })
            })

            test('unexpected failure of the check: unreachable message', async () => {
                list.probeExternalApiProvider.mockRejectedValue(new Error('boom'))
                service.setManualUrl('videos.alpine-club.org')
                service.checkAndAdd()
                await flush()
                expect(props().manual).toMatchObject({ state: 'error', urlError: "Couldn't reach this address. Check it, and check that you're online." })
            })
        })

        describe('check (two steps, phone)', () => {
            test('success: stops at checked with a prefilled name, add() saves', async () => {
                service.setManualUrl('videos.alpine-club.org')
                service.check()
                await flush()

                expect(props().manual).toMatchObject({ state: 'checked', message: 'Found 3 routes.', name: 'Alpine Club', canSubmit: true })
                expect(servers.size).toBe(0)

                service.add()
                expect(servers.get('Alpine Club')).toBe('https://videos.alpine-club.org/')
            })

            test('works with an address only (no name yet): name typed after the check', async () => {
                service.setManualUrl('http://192.168.1.20')
                service.check()
                await flush()

                expect(props().manual).toMatchObject({ state: 'checked', name: '', canSubmit: false })
                service.add()
                expect(servers.size).toBe(0)
                expect(props().manual.nameError).toBe("Enter a name. It's shown in your route list.")

                service.setManualName('My Nas')
                expect(props().manual.canSubmit).toBe(true)
                service.add()
                expect(servers.get('My Nas')).toBe('http://192.168.1.20/')
            })

            test('0 routes: confirm, then the name step', async () => {
                list.probeExternalApiProvider.mockImplementation(probeOk(0))
                service.setManualUrl('videos.alpine-club.org')
                service.check()
                await flush()
                expect(props().manual.state).toBe('confirm-empty')
                service.confirmAddEmpty()
                expect(props().manual.state).toBe('checked')
                expect(servers.size).toBe(0)
            })

            test('add() without a check does nothing', () => {
                service.setManualUrl('videos.alpine-club.org')
                service.add()
                expect(servers.size).toBe(0)
            })

            test('hint for unreachable home-network addresses (mobile only)', async () => {
                setPlatform('mobile', 'ios')
                list.probeExternalApiProvider.mockImplementation(probeFail('unreachable', "Couldn't reach this address."))
                service.setManualUrl('nas:8080')
                service.check()
                await flush()
                expect(props().manual.urlError).toBe("Couldn't reach this address. On phones and tablets, the server's IP address (for example 192.168.1.20) often works better than its name.")

                service.setManualUrl('videos.example.org')
                service.check()
                await flush()
                expect(props().manual.urlError).toBe("Couldn't reach this address.")
            })
        })
    })

    describe('platform differences', () => {
        const allowsLocalHttp = () => (service as unknown as { allowsLocalHttp: boolean }).allowsLocalHttp
        const hint = (isHomeNetwork: boolean) => (service as unknown as { getUnreachableHint: (v: boolean) => string | undefined }).getUnreachableHint(isHomeNetwork)

        test.each(['desktop', 'web'])('%s: home-network http is allowed, no extra hint', (channel) => {
            setPlatform(channel, 'linux')
            expect(allowsLocalHttp()).toBe(true)
            expect(hint(true)).toBeUndefined()
        })

        test.each(['ios', 'iOS'])('mobile %s: home-network http is allowed', (platform) => {
            setPlatform('mobile', platform)
            expect(allowsLocalHttp()).toBe(true)
        })

        test.each(['android', 'Android', 'linux', 'win32', 'darwin', 'web', 'ios-simulator', '', undefined])('mobile %s: not positively iOS, not allowed', (platform) => {
            setPlatform('mobile', platform)
            expect(allowsLocalHttp()).toBe(false)
        })

        test('no OS info: not allowed', () => {
            Inject('Bindings', { appInfo: { getChannel: () => 'mobile' } })
            expect(allowsLocalHttp()).toBe(false)
        })

        test('hint for unreachable home-network addresses only, on mobile', () => {
            setPlatform('mobile', 'android')
            expect(hint(true)).toBe("On phones and tablets, the server's IP address (for example 192.168.1.20) often works better than its name.")
            expect(hint(false)).toBeUndefined()
        })
    })

    describe('remove', () => {
        beforeEach(() => {
            servers.set('Alpine Videos', 'https://alpine.example.org/')
        })

        test('unknown key: ignored', () => {
            service.requestRemove('Nope')
            expect(props().removeDialog).toBeUndefined()
        })

        test('server without routes: simple dialog', () => {
            service.requestRemove('Alpine Videos')
            expect(props().removeDialog).toEqual({
                key: 'Alpine Videos', name: 'Alpine Videos', routeCount: 0, removeRoutes: false,
                title: 'Remove "Alpine Videos"?', confirmLabel: 'Remove'
            })
            expect(list.getExternalApiProviderDownloadInfo).not.toHaveBeenCalled()
        })

        test('server with routes: keep is the default, both outcomes are written out', () => {
            counts['Alpine Videos'] = 24
            service.requestRemove('Alpine Videos')
            expect(props().removeDialog).toMatchObject({
                routeCount: 24, removeRoutes: false,
                text: 'You have 24 routes from this server in your route list.',
                keepLabel: 'Keep these routes', removeRoutesLabel: 'Remove these routes too', confirmLabel: 'Remove server'
            })
        })

        test('downloaded videos and their size are mentioned once known', async () => {
            counts['Alpine Videos'] = 24
            list.getExternalApiProviderDownloadInfo.mockResolvedValue({ routeCount: 24, downloadedCount: 3, downloadedBytes: 1.2 * 1024 ** 3 })
            service.requestRemove('Alpine Videos')
            await flush()
            expect(props().removeDialog).toMatchObject({
                downloadedCount: 3, downloadedSize: '1.2 GB',
                removeRoutesLabel: 'Remove these routes too, including 3 downloaded videos (1.2 GB).'
            })
        })

        test('downloaded videos with unknown size', async () => {
            counts['Alpine Videos'] = 2
            list.getExternalApiProviderDownloadInfo.mockResolvedValue({ routeCount: 2, downloadedCount: 1, downloadedBytes: undefined })
            service.requestRemove('Alpine Videos')
            await flush()
            expect(props().removeDialog.removeRoutesLabel).toBe('Remove these routes too, including 1 downloaded video.')
        })

        test('download info arriving after cancel is ignored', async () => {
            counts['Alpine Videos'] = 2
            service.requestRemove('Alpine Videos')
            service.cancelRemove()
            await flush()
            expect(props().removeDialog).toBeUndefined()
        })

        test('setRemoveRoutes toggles the choice', () => {
            counts['Alpine Videos'] = 2
            service.requestRemove('Alpine Videos')
            service.setRemoveRoutes(true)
            expect(props().removeDialog.removeRoutes).toBe(true)
            service.setRemoveRoutes(false)
            expect(props().removeDialog.removeRoutes).toBe(false)
        })

        test('confirm with keep: only the server is removed', async () => {
            counts['Alpine Videos'] = 2
            service.requestRemove('Alpine Videos')
            service.confirmRemove()
            await flush()

            expect(list.deleteExternalApiProvider).toHaveBeenCalledWith('Alpine Videos')
            expect(list.deleteExternalApiProviderRoutes).not.toHaveBeenCalled()
            expect(props().removeDialog).toBeUndefined()
            expect(props().servers.map(s => s.name)).toEqual(['Incyclist'])
        })

        test('confirm with remove routes: routes are removed as well', async () => {
            counts['Alpine Videos'] = 2
            service.requestRemove('Alpine Videos')
            service.setRemoveRoutes(true)
            service.confirmRemove()
            await flush()

            expect(list.deleteExternalApiProvider).toHaveBeenCalledWith('Alpine Videos')
            expect(list.deleteExternalApiProviderRoutes).toHaveBeenCalledWith('Alpine Videos')
        })

        test('cancel leaves everything as it was', () => {
            service.requestRemove('Alpine Videos')
            service.cancelRemove()
            expect(props().removeDialog).toBeUndefined()
            expect(list.deleteExternalApiProvider).not.toHaveBeenCalled()
        })

        test('confirm without dialog does nothing', () => {
            service.confirmRemove()
            expect(list.deleteExternalApiProvider).not.toHaveBeenCalled()
        })

        test('after removal a known entry is available again', async () => {
            known = KNOWN
            servers.clear()
            servers.set('Alpine Videos', 'https://alpine.example.org/api/v1/routes')
            expect(props().known[0].state).toBe('added')
            service.requestRemove('Alpine Videos')
            service.confirmRemove()
            await flush()
            expect(props().known[0].state).toBe('available')
        })
    })
})
