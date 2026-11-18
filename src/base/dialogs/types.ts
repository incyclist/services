import type { IObserver } from "../typedefs"

export interface IDialogService {
    openDialog(...args: unknown[]): IObserver
    closeDialog(): void
    getDialogObserver(): IObserver | undefined
}
