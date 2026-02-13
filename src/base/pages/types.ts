import { IObserver } from "../typedefs"

export interface IPageService {
    openPage(): IObserver
    closePage():void
    pausePage():Promise<void>
    resumePage():Promise<void>
    getPageObserver():IObserver
}