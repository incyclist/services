import { getBindings } from "../api";
import { Injectable } from "../base/decorators";
import { IncyclistService } from "../base/service";
import { Observer, Singleton } from "../base/types";

export class VideoConversion extends IncyclistService {
    protected observer: Observer
    protected conversion: Observer
    protected url: string

    constructor(url: string) {
        super('VideoConversion')
        this.url = url
        this.observer = new Observer()
    }

    getObserver() {
        return this.observer
    }

    async convert( props?) {
        const video = this.getVideoBindings()
        try {
            this.conversion = await  video.convert(this.url,props)
            this.conversion.on('started', () => {
                this.observer.emit('convert-start')
            });
            this.conversion.on('progress', this.onConvertProgress.bind(this));

            this.conversion.once('error', (err: Error) => {
                this.conversion.stop()
                this.logEvent ( {message: 'conversion error', url:this.url, error:err.message, stack:err.stack})
                this.observer.emit('convert-error',err.message)
            });
        }
        catch (err) {
            this.logEvent ( {message: 'conversion error', url:this.url, error:err.message, stack:err.stack})
            this.observer.emit('convert-error',err.message )
        }
        
    }

    protected onConvertProgress (info) {
        // TODO
    }
    protected onConvertCompleted () {
        // TODO
        this.conversion.stop()
    }

    @Injectable
    protected getVideoBindings() {
        return getBindings().video
    }


}