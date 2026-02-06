import type { IObserver } from "../types"

export interface IPageService {
    openPage(): IObserver
    closePage():void
    pausePage():void
    resumePage():void
    getPageObserver():IObserver
}