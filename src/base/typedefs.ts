export interface IObserver{
    on(event:string, callback):IObserver
    off(event:string, callback):IObserver
    once(event:string, callback):IObserver
    stop()
    emit(event:string, ...data)
}


