import { EventEmitter} from 'node:events';
import { EventLogger } from 'gd-eventlog';

export class IncyclistService extends EventEmitter {
    protected logger: EventLogger
    protected debug;
    protected injected:Record<string,any> = {}

    constructor(serviceName:string) {
        super()
        this.logger = new EventLogger(serviceName)
        this.debug = false;   
    }

    inject (string, value) {
        this.injected[string] = value
    }
    
    logEvent(event) {
        this.logger.logEvent(event)
        const emitPayload = {...event}
        delete emitPayload.ts
        this.emit('log',emitPayload)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = global.window as any
    
        if (this.debug || w?.SERVICE_DEBUG || process.env.DEBUG) 
            console.log(`~~~ ${this.logger.getName().toUpperCase()}-SVC`, event)
    }

    setDebug(enabled:boolean) {
        this.debug = enabled
    }


    logError(err:Error, fn:string, args?) {
        const logInfo = args ?? {}

        this.logEvent({message:'Error', fn, ...logInfo, error:err.message, stack:err.stack})
    }

    reset() {        
        this.removeAllListeners()
    }

}