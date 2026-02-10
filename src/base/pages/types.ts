import { IObserver } from "../typedefs"

export interface IPageService {
    openPage(): IObserver
    closePage():void
    pausePage():void
    resumePage():void
    getPageObserver():IObserver
}