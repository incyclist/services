import { EventLogger } from "gd-eventlog"
import { Observer } from "../../base/types/observer"

export class PageLogObserver extends Observer {
    protected logger:EventLogger
    constructor(protected loggerContext:string) { 
        super()
        this.logger = new EventLogger(loggerContext)
    }

    emit(event: string, ...data: any[]): void {
        super.emit(event,...data)
        this.logger.logEvent( {message:'Pairing page state event',event})
    }
}
