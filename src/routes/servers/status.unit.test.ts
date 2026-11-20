import { RouteServerStatusStore, useRouteServerStatus } from './status'

describe('RouteServerStatusStore', () => {
    let store: RouteServerStatusStore
    beforeEach(() => { store = useRouteServerStatus() })
    afterEach(() => { store.reset() })

    test('unknown before any load', () => {
        expect(store.getStatus('Alpine')).toBe('unknown')
        expect(store.getResult('Alpine')).toBeUndefined()
    })

    test('loading, then result', () => {
        const changed = jest.fn()
        store.on('changed', changed)

        store.setLoading('Alpine')
        expect(store.getStatus('Alpine')).toBe('loading')

        store.setResult('Alpine', { status: 'ok', routeCount: 24 })
        expect(store.getStatus('Alpine')).toBe('ok')
        expect(store.getResult('Alpine')).toEqual({ status: 'ok', routeCount: 24 })
        expect(changed).toHaveBeenCalledTimes(2)
    })

    test('a load without result keeps the previous result', () => {
        store.setResult('Alpine', { status: 'unreachable', routeCount: 0 })
        store.setLoading('Alpine')
        store.clearLoading('Alpine')
        expect(store.getStatus('Alpine')).toBe('unreachable')
    })

    test('remove forgets the server', () => {
        store.setResult('Alpine', { status: 'empty', routeCount: 0 })
        store.remove('Alpine')
        expect(store.getStatus('Alpine')).toBe('unknown')
    })
})
