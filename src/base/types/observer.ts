import { EventEmitter } from "events"
import { waitNextTick } from "../../utils"
import { IObserver } from "../typedefs";


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

    stop( props:{immediately?:boolean}={}) {
        this.emitter.emit('stopped')
        
        if ( this.emitter.listenerCount()>0 ) {    
            if (props.immediately) {
                this.emitter.removeAllListeners()
            }
            else {
                setTimeout( ()=>{
                    this.emitter.removeAllListeners()               
                }, 1000)            
            }
        }        
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
            const res = await this.promise
            await waitNextTick()
            return res
        }
        catch {
            // ignore
            await waitNextTick()
        }
    }

}