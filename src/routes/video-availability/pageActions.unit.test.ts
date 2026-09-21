import { RouteVideoPageActions } from './pageActions'
import type { RouteVideoState, RouteVideoStatus, VideoKeepChoice } from './types'

const emptyStatus = (routeId: string, over: Partial<RouteVideoStatus> = {}): RouteVideoStatus => ({
    routeId, state: 'unknown', isICloud: false, fileCount: 0, notDownloadedCount: 0,
    confirmedThisSession: false, ...over
})

const statusFor = (state: RouteVideoState, over: Partial<RouteVideoStatus> = {}): RouteVideoStatus =>
    emptyStatus('r1', { state, fileCount: 1, notDownloadedCount: state === 'ready' ? 0 : 1, ...over })

describe('RouteVideoPageActions', () => {

    let service: any
    let availability: {
        isSupported: jest.Mock, getStatus: jest.Mock, needsConfirmation: jest.Mock,
        download: jest.Mock, stop: jest.Mock, retry: jest.Mock, setChoice: jest.Mock, remove: jest.Mock
    }
    let folderAccess: { getTargetFor: jest.Mock, confirmAccess: jest.Mock }
    let routeList: { getAllRoutes: jest.Mock }
    let online: { onlineStatus: boolean }
    let logged: Array<any>

    const setup = (props: { unsupported?: boolean, status?: RouteVideoStatus } = {}) => {
        availability = {
            isSupported: jest.fn(() => !props.unsupported),
            getStatus: jest.fn(() => props.status ?? emptyStatus('r1')),
            needsConfirmation: jest.fn(() => true),
            download: jest.fn().mockResolvedValue(undefined),
            stop: jest.fn().mockResolvedValue(undefined),
            retry: jest.fn().mockResolvedValue(undefined),
            setChoice: jest.fn().mockResolvedValue(undefined),
            remove: jest.fn().mockResolvedValue('removed')
        }

        folderAccess = {
            getTargetFor: jest.fn(() => ({ folder: '/icloud/Videos', displayPath: 'Videos', location: 'icloud', siblingCount: 0 })),
            confirmAccess: jest.fn().mockResolvedValue({ outcome: 'confirmed', coversRoute: true, restoredCount: 1 })
        }

        routeList = {
            getAllRoutes: jest.fn(() => [{ description: { id: 'r1', title: 'Alpine Loop' } }])
        }

        online = { onlineStatus: true }
        logged = []

        service = new RouteVideoPageActions()
        service.inject('Availability', availability)
        service.inject('FolderAccess', folderAccess)
        service.inject('RouteList', routeList)
        service.inject('OnlineStatus', online)
        service.logEvent = (event: any) => { logged.push(event) }

        return service
    }

    afterEach(() => {
        service?.reset()
        service = undefined
    })

    // ------------------------------------------------------------------ inertness

    describe('without the binding', () => {

        test('every handler is a safe no-op, and display props are the inert default', async () => {
            setup({ unsupported: true })

            service.onVideoDownloadPressed('r1')
            service.onVideoDownloadConfirmed('r1', 'keep')
            service.onVideoDownloadDismissed('r1')
            service.onVideoStop('r1')
            service.onVideoRetry('r1')
            service.onVideoKeepInstead('r1')
            service.onVideoRemovePressed('r1')
            service.onVideoRemoveConfirmed('r1')
            service.onVideoRemoveDismissed('r1')
            await service.onConfirmAccess('r1')

            expect(availability.download).not.toHaveBeenCalled()
            expect(availability.stop).not.toHaveBeenCalled()
            expect(availability.retry).not.toHaveBeenCalled()
            expect(availability.setChoice).not.toHaveBeenCalled()
            expect(availability.remove).not.toHaveBeenCalled()
            expect(folderAccess.confirmAccess).not.toHaveBeenCalled()

            const props = service.getDisplayProps('r1')
            expect(props.confirmation).toBeUndefined()
            expect(props.removeConfirmation).toBeUndefined()
            expect(props.access).toBeUndefined()
        })
    })

    // ------------------------------------------------------------------ status -> actions mapping

    describe('status -> actions mapping', () => {

        const actionsFor = (state: RouteVideoState, over: Partial<RouteVideoStatus> = {}) => {
            setup({ status: statusFor(state, over) })
            return service.getDisplayProps('r1')
        }

        test('checking: nothing to do yet', () => {
            const props = actionsFor('checking')
            expect(props.canStart).toBe(false)
            expect(props.actions).toEqual({
                download: false, downloadEnabled: false, stop: false, retry: false,
                keepInstead: false, remove: false, confirmAccess: false
            })
        })

        test('ready, no choice on record: nothing to do, ride can start', () => {
            const props = actionsFor('ready')
            expect(props.canStart).toBe(true)
            expect(props.actions).toEqual({
                download: false, downloadEnabled: false, stop: false, retry: false,
                keepInstead: false, remove: false, confirmAccess: false
            })
        })

        test('ready, kept: can be removed, not converted', () => {
            const props = actionsFor('ready', { choice: 'keep', isICloud: true })
            expect(props.canStart).toBe(true)
            expect(props.actions.remove).toBe(true)
            expect(props.actions.keepInstead).toBe(false)
        })

        test('ready, iCloud, journal entry cleared after a finished keep: still removable', () => {
            // a completed "keep" download has its journal entry discarded (service.ts onDownloadProgress),
            // so `choice` is gone by the time the route reaches `ready` - `remove` must not depend on it
            const props = actionsFor('ready', { isICloud: true })
            expect(props.actions.remove).toBe(true)
            expect(props.actions.keepInstead).toBe(false)
        })

        test('ready, for this ride: can be removed now or converted to a keep', () => {
            const props = actionsFor('ready', { choice: 'this-ride', thisRide: true, isICloud: true })
            expect(props.canStart).toBe(true)
            expect(props.actions.remove).toBe(true)
            expect(props.actions.keepInstead).toBe(true)
        })

        test('ready, not iCloud: a plain local video has nothing to remove', () => {
            const props = actionsFor('ready', { isICloud: false })
            expect(props.actions.remove).toBe(false)
        })

        test('unknown: never gated, nothing to do', () => {
            const props = actionsFor('unknown')
            expect(props.canStart).toBe(true)
            expect(props.actions).toEqual({
                download: false, downloadEnabled: false, stop: false, retry: false,
                keepInstead: false, remove: false, confirmAccess: false
            })
        })

        test('not-downloaded: a fresh, enabled download offer', () => {
            const props = actionsFor('not-downloaded')
            expect(props.canStart).toBe(false)
            expect(props.actions.download).toBe(true)
            expect(props.actions.downloadEnabled).toBe(true)
        })

        test('not-enough-storage: download is offered but disabled', () => {
            const props = actionsFor('not-enough-storage')
            expect(props.actions.download).toBe(true)
            expect(props.actions.downloadEnabled).toBe(false)
        })

        test('downloading: only stop applies', () => {
            const props = actionsFor('downloading')
            expect(props.actions).toEqual({
                download: false, downloadEnabled: false, stop: true, retry: false,
                keepInstead: false, remove: false, confirmAccess: false
            })
        })

        test('waiting-for-network: still an app-owned transfer, so stop applies', () => {
            const props = actionsFor('waiting-for-network')
            expect(props.actions.stop).toBe(true)
        })

        test('downloading-external: watched only, nothing this app can do', () => {
            const props = actionsFor('downloading-external')
            expect(props.actions).toEqual({
                download: false, downloadEnabled: false, stop: false, retry: false,
                keepInstead: false, remove: false, confirmAccess: false
            })
        })

        test('cancelled: a stopped download can be retried', () => {
            const props = actionsFor('cancelled')
            expect(props.actions.retry).toBe(true)
            expect(props.actions.download).toBe(false)
        })

        test('download-failed: same as cancelled, retry applies', () => {
            const props = actionsFor('download-failed')
            expect(props.actions.retry).toBe(true)
        })

        test('access-lost, not transient: confirm access applies', () => {
            const props = actionsFor('access-lost', { transient: false })
            expect(props.canStart).toBe(false)
            expect(props.actions.confirmAccess).toBe(true)
        })

        test('access-lost, transient: nothing a re-pick would fix', () => {
            const props = actionsFor('access-lost', { transient: true })
            expect(props.actions.confirmAccess).toBe(false)
        })

        test('not-found: nothing to do', () => {
            const props = actionsFor('not-found')
            expect(props.actions).toEqual({
                download: false, downloadEnabled: false, stop: false, retry: false,
                keepInstead: false, remove: false, confirmAccess: false
            })
        })
    })

    // ------------------------------------------------------------------ download confirmation flow

    describe('download confirmation flow', () => {

        test('pressing download opens the confirmation the first time', () => {
            setup({ status: statusFor('not-downloaded') })

            service.onVideoDownloadPressed('r1')

            expect(availability.download).not.toHaveBeenCalled()
            expect(availability.retry).not.toHaveBeenCalled()

            const props = service.getDisplayProps('r1')
            expect(props.confirmation).toMatchObject({ routeTitle: 'Alpine Loop', fileCount: 1, offline: false })
        })

        test('confirming starts the download with the chosen option and closes the dialog', async () => {
            setup({ status: statusFor('not-downloaded') })
            service.onVideoDownloadPressed('r1')

            service.onVideoDownloadConfirmed('r1', 'this-ride' as VideoKeepChoice)
            await Promise.resolve()

            expect(availability.download).toHaveBeenCalledWith('r1', 'this-ride')
            expect(service.getDisplayProps('r1').confirmation).toBeUndefined()
        })

        test('dismissing closes the dialog without starting anything', () => {
            setup({ status: statusFor('not-downloaded') })
            service.onVideoDownloadPressed('r1')

            service.onVideoDownloadDismissed('r1')

            expect(availability.download).not.toHaveBeenCalled()
            expect(service.getDisplayProps('r1').confirmation).toBeUndefined()
        })

        test('the confirmation reflects being offline', () => {
            setup({ status: statusFor('not-downloaded') })
            online.onlineStatus = false

            service.onVideoDownloadPressed('r1')

            expect(service.getDisplayProps('r1').confirmation).toMatchObject({ offline: true })
        })

        test('session-direct path: once answered this session, pressing download again skips the dialog', () => {
            setup({ status: statusFor('cancelled') })
            availability.needsConfirmation.mockReturnValue(false)

            service.onVideoDownloadPressed('r1')

            expect(availability.retry).toHaveBeenCalledWith('r1')
            expect(availability.download).not.toHaveBeenCalled()
            expect(service.getDisplayProps('r1').confirmation).toBeUndefined()
        })
    })

    // ------------------------------------------------------------------ remove confirmation flow

    describe('remove confirmation flow', () => {

        test('pressing remove opens its own confirmation', () => {
            setup({ status: statusFor('ready', { choice: 'keep', sizeBytes: 123 }) })

            service.onVideoRemovePressed('r1')

            expect(availability.remove).not.toHaveBeenCalled()
            expect(service.getDisplayProps('r1').removeConfirmation).toEqual({ sizeBytes: 123 })
        })

        test('confirming removes and closes the dialog', async () => {
            setup({ status: statusFor('ready', { choice: 'keep' }) })
            service.onVideoRemovePressed('r1')

            service.onVideoRemoveConfirmed('r1')
            await Promise.resolve()

            expect(availability.remove).toHaveBeenCalledWith('r1')
            expect(service.getDisplayProps('r1').removeConfirmation).toBeUndefined()
            expect(service.getDisplayProps('r1').removeFailed).toBeUndefined()
        })

        test('surfaces removeFailed when the remove resolves without removing', async () => {
            setup({ status: statusFor('ready', { choice: 'keep' }) })
            availability.remove.mockResolvedValue('failed')
            service.onVideoRemovePressed('r1')

            await service.onVideoRemoveConfirmed('r1')

            expect(service.getDisplayProps('r1').removeFailed).toBe(true)
        })

        test('surfaces removeFailed when remove rejects', async () => {
            setup({ status: statusFor('ready', { choice: 'keep' }) })
            availability.remove.mockRejectedValue(new Error('boom'))
            service.onVideoRemovePressed('r1')

            await service.onVideoRemoveConfirmed('r1')

            expect(service.getDisplayProps('r1').removeFailed).toBe(true)
        })

        test('a later attempt clears a previous removeFailed', async () => {
            setup({ status: statusFor('ready', { choice: 'keep' }) })
            availability.remove.mockResolvedValueOnce('failed')
            service.onVideoRemovePressed('r1')
            await service.onVideoRemoveConfirmed('r1')
            expect(service.getDisplayProps('r1').removeFailed).toBe(true)

            availability.remove.mockResolvedValueOnce('removed')
            service.onVideoRemovePressed('r1')
            await service.onVideoRemoveConfirmed('r1')

            expect(service.getDisplayProps('r1').removeFailed).toBeUndefined()
        })

        test('dismissing closes the dialog without removing anything', () => {
            setup({ status: statusFor('ready', { choice: 'keep' }) })
            service.onVideoRemovePressed('r1')

            service.onVideoRemoveDismissed('r1')

            expect(availability.remove).not.toHaveBeenCalled()
            expect(service.getDisplayProps('r1').removeConfirmation).toBeUndefined()
        })
    })

    // ------------------------------------------------------------------ plain delegation

    describe('plain delegation', () => {

        test('stop, retry and keep-instead just forward to the availability service', () => {
            setup({ status: statusFor('downloading') })

            service.onVideoStop('r1')
            service.onVideoRetry('r1')
            service.onVideoKeepInstead('r1')

            expect(availability.stop).toHaveBeenCalledWith('r1')
            expect(availability.retry).toHaveBeenCalledWith('r1')
            expect(availability.setChoice).toHaveBeenCalledWith('r1', 'keep')
        })
    })

    // ------------------------------------------------------------------ access recovery

    describe('access recovery', () => {

        test('the target is computed on demand only while access is lost', () => {
            setup({ status: statusFor('access-lost', { transient: false }) })

            const props = service.getDisplayProps('r1')

            expect(folderAccess.getTargetFor).toHaveBeenCalledWith('r1')
            expect(props.access?.target).toMatchObject({ folder: '/icloud/Videos' })
        })

        test('no target is computed once the state is no longer access-lost', () => {
            setup({ status: statusFor('ready') })

            const props = service.getDisplayProps('r1')

            expect(folderAccess.getTargetFor).not.toHaveBeenCalled()
            expect(props.access).toBeUndefined()
        })

        test('confirming access records the outcome for the next display props', async () => {
            setup({ status: statusFor('access-lost', { transient: false }) })

            await service.onConfirmAccess('r1')

            expect(folderAccess.confirmAccess).toHaveBeenCalledWith('r1')
            expect(service.getDisplayProps('r1').access?.lastResult)
                .toEqual({ outcome: 'confirmed', coversRoute: true, restoredCount: 1 })
        })

        test('the last result is still shown once access-lost has cleared', async () => {
            // access was just restored: the underlying status has moved on, but the outcome of
            // the confirm-access flow the user just went through is still worth showing once
            setup({ status: statusFor('access-lost', { transient: false }) })
            await service.onConfirmAccess('r1')

            availability.getStatus.mockReturnValue(statusFor('ready'))

            const props = service.getDisplayProps('r1')
            expect(props.access?.lastResult).toEqual({ outcome: 'confirmed', coversRoute: true, restoredCount: 1 })
            expect(props.access?.target).toBeUndefined()
        })

        test('an error confirming access is logged, not thrown, and still updates the caller', async () => {
            setup({ status: statusFor('access-lost', { transient: false }) })
            folderAccess.confirmAccess.mockRejectedValue(new Error('picker failed'))

            await expect(service.onConfirmAccess('r1')).resolves.toBeUndefined()
            expect(logged.some((e: any) => e.message === 'Error')).toBe(true)
        })
    })
})
