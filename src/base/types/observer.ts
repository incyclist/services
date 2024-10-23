import EventEmitter from "events"
import { waitNextTick } from "../../utils"

export interface IObserver{
    on(event:string, callback):IObserver
    off(event:string, callback):IObserver
    once(event:string, callback):IObserver
    stop()
    emit(event:string, ...data)
}



export class Observer   implements IObserver  {

    protected emitter;

    constructor() {
        this.emitter = new EventEmitter()
    }

    on(event,callback):IObserver {
        this.emitter.on(event,callback)
        return this;
    }

    off(event,callback):IObserver {
        this.emitter.off(event,callback)
        return this;
    }

    once(event,callback):IObserver {
        this.emitter.once(event,callback)
        return this;
    }

    stop() {
        this.emitter.emit('stopped')
        setTimeout( ()=>{
            this.emitter.removeAllListeners()               
        }, 1000)
        
    }

    emit(event:string, ...data) {
        this.emitter.emit(event,...data)
    }

    reset() {
        this.emitter.removeAllListeners()                  
    }

}

export class PromiseObserver<T> extends Observer {
    promise: Promise<T>

    static alwaysReturning<T> ( res?:T) {
        const fn = async (): Promise<T> => { return res}
        const promise = new PromiseObserver<T>( fn() )
        promise.start()
        return promise
    }

    constructor(promise: Promise<T>) {
        super()
        this.promise = promise
    }

    async start():Promise<T> {
        await waitNextTick()
        
        return new Promise(  (resolve,reject) => {
            this.emitter.emit('started')

            this.promise
                .then( (res:T) => {
                    this.emitter.emit('done',res)
                    resolve(res)
                })
                .catch( (err:Error) => {
                    reject(err)
                })                    
        })

    }




    async wait():Promise<T> {
        try {
            return await this.promise
        }
        catch {
            // ignore
        }
    }

}