import { IncyclistPageService } from '../pages/service'
import { IncyclistDialogService } from './service'

type Props = { value: number }

class TestDialogService extends IncyclistDialogService<Props> {
    value = 1
    constructor() {
        super('TestDialog')
    }
    getDialogDisplayProps(): Props {
        return { value: this.value }
    }
    update() {
        this.emitDialogUpdate()
    }
}

describe('IncyclistDialogService', () => {
    let service: TestDialogService

    beforeEach(() => {
        service = new TestDialogService()
    })

    afterEach(() => {
        service.reset()
    })

    test('openDialog returns an observer that is available via getDialogObserver', () => {
        const observer = service.openDialog()
        expect(observer).toBeDefined()
        expect(service.getDialogObserver()).toBe(observer)
    })

    test('reopening stops the earlier observer', () => {
        const first = service.openDialog()
        const stop = jest.spyOn(first, 'stop')
        const second = service.openDialog()

        expect(stop).toHaveBeenCalled()
        expect(second).not.toBe(first)
        expect(service.getDialogObserver()).toBe(second)
    })

    test('closeDialog stops and drops the observer', () => {
        const observer = service.openDialog()
        const stop = jest.spyOn(observer, 'stop')
        service.closeDialog()

        expect(stop).toHaveBeenCalled()
        expect(service.getDialogObserver()).toBeUndefined()
    })

    test('closeDialog without openDialog is safe', () => {
        expect(() => service.closeDialog()).not.toThrow()
        expect(service.getDialogObserver()).toBeUndefined()
    })

    test('emitDialogUpdate emits the display props as dialog-update', () => {
        const observer = service.openDialog()
        const handler = jest.fn()
        observer.on('dialog-update', handler)
        service.value = 5
        service.update()
        expect(handler).toHaveBeenCalledWith({ value: 5 })
    })

    test('emitDialogUpdate without an open dialog does nothing', () => {
        expect(() => service.update()).not.toThrow()
    })

    test('does not touch app state or the current page', () => {
        const setState = jest.fn()
        ;(service as unknown as { getAppState: () => unknown }).getAppState = () => ({ setState })
        const other = { closePage: jest.fn() } as unknown as typeof IncyclistPageService.currentPage
        IncyclistPageService.currentPage = other

        service.openDialog()
        service.closeDialog()

        expect(IncyclistPageService.currentPage).toBe(other)
        expect(setState).not.toHaveBeenCalled()
        delete IncyclistPageService.currentPage
    })
})
