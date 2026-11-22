import { LinkBrowse, parseInstanceName } from './browse'
import type { LinkMdnsAnnouncement, LinkWifiBinding } from './types'

describe('parseInstanceName', () => {
    test('splits the display name and the random suffix', () => {
        expect(parseInstanceName('Home PC (K3F9)')).toEqual({ displayName: 'Home PC', suffix: 'K3F9' })
    })
    test('a name with brackets of its own keeps them', () => {
        expect(parseInstanceName('PC (old) (K3F9)')).toEqual({ displayName: 'PC (old)', suffix: 'K3F9' })
    })
    test('a name without a suffix is returned as is', () => {
        expect(parseInstanceName('Home PC')).toEqual({ displayName: 'Home PC' })
        expect(parseInstanceName('Home PC (kitchen)')).toEqual({ displayName: 'Home PC (kitchen)' })
    })
})

describe('LinkBrowse', () => {
    let up: ((s: LinkMdnsAnnouncement) => void) | undefined
    let wifi: LinkWifiBinding & { mdns: { connect: jest.Mock, disconnect: jest.Mock, find: jest.Mock } }

    beforeEach(() => {
        jest.useFakeTimers()
        up = undefined
        wifi = {
            net: { createSocket: jest.fn() },
            mdns: { connect: jest.fn(), disconnect: jest.fn(), find: jest.fn((_o, cb) => { up = cb }) },
        } as never
    })
    afterEach(() => {
        jest.useRealTimers()
    })

    test('runs for the time box, reports each computer once and releases the browser', async () => {
        const found: string[] = []
        const run = new LinkBrowse(wifi).run(10_000, f => found.push(f.name))
        await jest.advanceTimersByTimeAsync(1)
        up?.({ type: 'incyclist', name: 'A', address: '10.0.0.1', port: 1 })
        up?.({ type: 'incyclist', name: 'A', address: '10.0.0.1', port: 1 })
        up?.({ type: 'incyclist', name: 'B', address: '10.0.0.2', port: 2 })
        up?.({ type: 'other', name: 'C', address: '10.0.0.3', port: 3 })
        up?.({ name: 'D', address: '', port: 4 })

        await jest.advanceTimersByTimeAsync(10_000)
        expect((await run).map(r => r.name)).toEqual(['A', 'B'])
        expect(found).toEqual(['A', 'B'])
        expect(wifi.mdns.find).toHaveBeenCalledWith({ type: 'incyclist', protocol: 'tcp' }, expect.any(Function))
        expect(wifi.mdns.disconnect).toHaveBeenCalledTimes(1)
    })

    test('cancel ends it early', async () => {
        const browse = new LinkBrowse(wifi)
        const run = browse.run(10_000)
        await jest.advanceTimersByTimeAsync(1)
        browse.cancel()
        expect(await run).toEqual([])
        expect(wifi.mdns.disconnect).toHaveBeenCalled()
    })

    test('releases the browser when starting fails', async () => {
        wifi.mdns.find.mockImplementation(() => { throw new Error('x') })
        await expect(new LinkBrowse(wifi).run(10_000)).rejects.toThrow('x')
        expect(wifi.mdns.disconnect).toHaveBeenCalled()
    })
})
