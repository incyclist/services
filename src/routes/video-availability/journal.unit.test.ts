import { MAX_EVICT_AGE_MS, MAX_EVICT_ATTEMPTS, VideoDownloadJournal } from './journal'

type RepoMock = {
    read: jest.Mock, write: jest.Mock, delete: jest.Mock, list: jest.Mock,
    docs: Map<string, any>
}

const createRepoMock = (stored?: Record<string, any>): RepoMock => {
    const docs = new Map<string, any>()
    if (stored)
        docs.set('entries', { entries: stored })

    return {
        docs,
        read: jest.fn(async (name: string) => docs.get(name)),
        write: jest.fn(async (name: string, data: any) => { docs.set(name, data); return true }),
        delete: jest.fn(async (name: string) => docs.delete(name)),
        list: jest.fn(async () => [...docs.keys()])
    }
}

const storedEntry = (over: Record<string, any> = {}) => ({
    path: '/icloud/a.mp4', routeId: 'r1', choice: 'this-ride',
    status: 'awaiting-ride', startedAt: 1000, evictAttempts: 0, ...over
})

describe('VideoDownloadJournal', () => {

    let journal: any
    let repo: RepoMock
    let logged: Array<any>

    const setup = (stored?: Record<string, any>) => {
        repo = createRepoMock(stored)
        logged = []

        journal = new VideoDownloadJournal()
        journal.inject('JournalRepo', repo)
        journal.logEvent = (event: any) => { logged.push(event) }

        return journal
    }

    afterEach(() => {
        journal?.reset()
        journal = undefined
    })

    /** What is actually on disk, as opposed to what is in memory. */
    const persisted = () => repo.docs.get('entries')?.entries ?? {}

    describe('loading', () => {

        test('reads the stored entries', async () => {
            setup({ '/icloud/a.mp4': storedEntry() })

            await journal.init()

            expect(journal.getEntry('/icloud/a.mp4')?.status).toBe('awaiting-ride')
            expect(journal.getAll()).toHaveLength(1)
        })

        test('is read only once, however many callers ask', async () => {
            setup({ '/icloud/a.mp4': storedEntry() })

            await Promise.all([journal.init(), journal.init(), journal.init()])

            expect(repo.read).toHaveBeenCalledTimes(1)
        })

        test('an unreadable journal is empty rather than fatal', async () => {
            setup()
            repo.read.mockRejectedValue(new Error('no repo'))

            await journal.init()

            expect(journal.getAll()).toEqual([])
        })

        test('malformed records are skipped', async () => {
            setup({ '/icloud/a.mp4': { path: '/icloud/a.mp4' }, '/icloud/b.mp4': storedEntry({ path: '/icloud/b.mp4' }) })

            await journal.init()

            expect(journal.getAll().map((e: any) => e.path)).toEqual(['/icloud/b.mp4'])
        })
    })

    describe('begin', () => {

        test('persists the entry and reports success', async () => {
            setup()

            const ok = await journal.begin('/icloud/a.mp4', 'r1', 'this-ride')

            expect(ok).toBe(true)
            expect(persisted()['/icloud/a.mp4']).toMatchObject({
                routeId: 'r1', choice: 'this-ride', status: 'downloading', evictAttempts: 0
            })
        })

        test('an entry that could not be written leaves no claim behind', async () => {
            setup()
            repo.write.mockResolvedValue(false)

            const ok = await journal.begin('/icloud/a.mp4', 'r1', 'this-ride')

            expect(ok).toBe(false)
            expect(journal.getEntry('/icloud/a.mp4')).toBeUndefined()
            expect(logged.map(e => e.message)).toContain('video journal write failed')
        })

        test('a write that throws is treated the same way', async () => {
            setup()
            repo.write.mockRejectedValue(new Error('disk full'))

            const ok = await journal.begin('/icloud/a.mp4', 'r1', 'keep')

            expect(ok).toBe(false)
            expect(journal.getEntry('/icloud/a.mp4')).toBeUndefined()
        })

        test('restarting a stopped download keeps the original start time', async () => {
            setup({ '/icloud/a.mp4': storedEntry({ status: 'stopping', startedAt: 500, stoppedAt: 900, evictAttempts: 3 }) })

            await journal.begin('/icloud/a.mp4', 'r1', 'keep')

            expect(journal.getEntry('/icloud/a.mp4')).toMatchObject({
                status: 'downloading', startedAt: 500, evictAttempts: 0
            })
            expect(journal.getEntry('/icloud/a.mp4').stoppedAt).toBeUndefined()
        })

        test('emits a change', async () => {
            setup()
            const changed = jest.fn()
            journal.on('changed', changed)

            await journal.begin('/icloud/a.mp4', 'r1', 'keep')

            expect(changed).toHaveBeenCalled()
        })
    })

    describe('status transitions', () => {

        test('stopping records when it was stopped and is due at once', async () => {
            setup({ '/icloud/a.mp4': storedEntry({ status: 'downloading' }) })
            await journal.init()

            await journal.markStopping('/icloud/a.mp4')

            const entry = journal.getEntry('/icloud/a.mp4')
            expect(entry.status).toBe('stopping')
            expect(entry.stoppedAt).toBeDefined()
            expect(entry.dueAt).toBeLessThanOrEqual(Date.now())
            expect(persisted()['/icloud/a.mp4'].status).toBe('stopping')
        })

        test('a finished "for this ride" download waits for the ride, with no deadline', async () => {
            setup({ '/icloud/a.mp4': storedEntry({ status: 'downloading' }) })
            await journal.init()

            await journal.markAwaitingRide('/icloud/a.mp4')

            expect(journal.getEntry('/icloud/a.mp4').status).toBe('awaiting-ride')
            expect(journal.getEntry('/icloud/a.mp4').dueAt).toBeUndefined()
        })

        test('removal is persisted with its due time before anything is evicted', async () => {
            setup({ '/icloud/a.mp4': storedEntry() })
            await journal.init()

            await journal.markRemovalDue('/icloud/a.mp4', 4242)

            expect(persisted()['/icloud/a.mp4']).toMatchObject({ status: 'removal-due', dueAt: 4242 })
        })

        test('a patch on an unknown path does nothing', async () => {
            setup()
            await journal.init()

            await journal.markStopping('/icloud/gone.mp4')

            expect(journal.getAll()).toEqual([])
        })
    })

    describe('setChoice', () => {

        test('switching a waiting removal to keep drops the entry entirely', async () => {
            setup({ '/icloud/a.mp4': storedEntry({ status: 'awaiting-ride' }) })
            await journal.init()

            await journal.setChoice('/icloud/a.mp4', 'keep')

            expect(journal.getEntry('/icloud/a.mp4')).toBeUndefined()
            expect(persisted()['/icloud/a.mp4']).toBeUndefined()
        })

        test('so does switching an already-due removal to keep', async () => {
            setup({ '/icloud/a.mp4': storedEntry({ status: 'removal-due', dueAt: 1 }) })
            await journal.init()

            await journal.setChoice('/icloud/a.mp4', 'keep')

            expect(journal.getEntry('/icloud/a.mp4')).toBeUndefined()
        })

        test('a running download just records the new choice', async () => {
            setup({ '/icloud/a.mp4': storedEntry({ status: 'downloading', choice: 'keep' }) })
            await journal.init()

            await journal.setChoice('/icloud/a.mp4', 'this-ride')

            expect(journal.getEntry('/icloud/a.mp4')).toMatchObject({ status: 'downloading', choice: 'this-ride' })
        })
    })

    describe('cleanup scheduling', () => {

        test('only stopping and removal-due entries are ever due', async () => {
            setup({
                '/a': storedEntry({ path: '/a', status: 'downloading', dueAt: 1 }),
                '/b': storedEntry({ path: '/b', status: 'awaiting-ride', dueAt: 1 }),
                '/c': storedEntry({ path: '/c', status: 'stopping', dueAt: 1 }),
                '/d': storedEntry({ path: '/d', status: 'removal-due', dueAt: 1 })
            })
            await journal.init()

            expect(journal.getCleanupDue().map((e: any) => e.path).sort()).toEqual(['/c', '/d'])
        })

        test('an entry whose backoff has not elapsed is not due yet', async () => {
            setup({ '/a': storedEntry({ path: '/a', status: 'stopping', dueAt: Date.now() + 60_000 }) })
            await journal.init()

            expect(journal.getCleanupDue()).toEqual([])
        })

        test('each failed attempt pushes the next one further out', async () => {
            setup({ '/a': storedEntry({ path: '/a', status: 'stopping', stoppedAt: Date.now() }) })
            await journal.init()

            const now = Date.now()
            expect(await journal.recordEvictAttempt('/a')).toBe('retry')
            const first = journal.getEntry('/a').dueAt - now

            expect(await journal.recordEvictAttempt('/a')).toBe('retry')
            const second = journal.getEntry('/a').dueAt - now

            expect(journal.getEntry('/a').evictAttempts).toBe(2)
            expect(second).toBeGreaterThan(first)
        })

        test('cleanup is given up after too many attempts', async () => {
            setup({
                '/a': storedEntry({
                    path: '/a', status: 'removal-due', stoppedAt: Date.now(), evictAttempts: MAX_EVICT_ATTEMPTS - 1
                })
            })
            await journal.init()

            expect(await journal.recordEvictAttempt('/a')).toBe('abandoned')
            expect(journal.getEntry('/a')).toBeUndefined()
            expect(logged.map(e => e.message)).toContain('restore abandoned')
        })

        test('and after too long', async () => {
            setup({
                '/a': storedEntry({
                    path: '/a', status: 'stopping', startedAt: 1, stoppedAt: Date.now() - MAX_EVICT_AGE_MS - 1
                })
            })
            await journal.init()

            expect(await journal.recordEvictAttempt('/a')).toBe('abandoned')
            expect(journal.getEntry('/a')).toBeUndefined()
        })

        test('a download or a waiting removal is never given up on', async () => {
            setup({
                '/a': storedEntry({ path: '/a', status: 'awaiting-ride', startedAt: 1, stoppedAt: 1, evictAttempts: 999 }),
                '/b': storedEntry({ path: '/b', status: 'downloading', startedAt: 1, stoppedAt: 1, evictAttempts: 999 })
            })
            await journal.init()

            expect(await journal.recordEvictAttempt('/a')).toBe('retry')
            expect(await journal.recordEvictAttempt('/b')).toBe('retry')
            expect(journal.getEntry('/a')).toBeDefined()
            expect(journal.getEntry('/b')).toBeDefined()
            expect(logged.map(e => e.message)).not.toContain('restore abandoned')
        })
    })

    test('discard removes the entry from disk', async () => {
        setup({ '/icloud/a.mp4': storedEntry() })
        await journal.init()

        await journal.discard('/icloud/a.mp4')

        expect(journal.getEntry('/icloud/a.mp4')).toBeUndefined()
        expect(persisted()['/icloud/a.mp4']).toBeUndefined()
    })

    test('getForRoute only returns that route\'s files', async () => {
        setup({
            '/a': storedEntry({ path: '/a', routeId: 'r1' }),
            '/b': storedEntry({ path: '/b', routeId: 'r2' }),
            '/c': storedEntry({ path: '/c', routeId: 'r1' })
        })
        await journal.init()

        expect(journal.getForRoute('r1').map((e: any) => e.path).sort()).toEqual(['/a', '/c'])
    })
})
