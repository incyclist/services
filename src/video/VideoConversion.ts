import { getBindings } from "../api";
import { Injectable } from "../base/decorators";
import { IncyclistService } from "../base/service";
import { Observer } from "../base/types";
import { Route } from "../routes/base/model/route";
import { ConversionInfo } from "./types";

export class VideoConversion extends IncyclistService {
    protected observer: Observer
    protected conversion: any
    protected url: string
    protected startPos: number
    protected route: Route
    protected isStarted: boolean

    constructor(url: string, route?:Route) {
        super('VideoConversion')
        this.url = url
        this.observer = new Observer()
        this.startPos = 0
        this.route = route
        this.isStarted = false
        
    }

    getObserver() {
        return this.observer
    }

    setStartPos(pos:number) {
        this.startPos = pos
    }


    async convert( props?) {
        const video = this.getVideoBindings()

        this.logEvent( {message:'start video conversion', url:this.url})


        try {
            const p = props??{}
            this.conversion = await video.convertOnline(this.url,{ progressInterval: 1,...p})
            this.conversion.on('started', this.onConvertStart.bind(this) );
            this.conversion.on('progress', this.onConvertProgress.bind(this));
            this.conversion.once('error', this.onConvertError.bind(this));
        }
        catch (err) {
            this.logEvent ( {message: 'error',fn:'convert', url:this.url, error:err.message, stack:err.stack})
            this.observer.emit('convert-error',err.message )
        }
        
    }

    async getNextSegment() {

        if (this.isStarted) {
            const next = await this.conversion.next()
            return next
        }
        else {
            return new Promise( done => {
                this.conversion.once('started',()=>{
                    this.conversion.next()
                        .then( done)
                })

            })
        }
    }

    async stop() {
 
        if (this.conversion)
            await this.conversion.stop()        
        delete this.conversion
        this.isStarted = false
    }

    protected onConvertStart() {
        this.observer.emit('convert-start')
        this.isStarted = true
    }

    protected onConvertProgress (info:ConversionInfo) {

        // convert time format hh:mm:ss[.mmm] into XXXXs
        const parseTime = (str: string):number => {
            if (!str || typeof str !== 'string') return undefined

            const clean = str.trim()
            const parts = clean.split(':')
            let seconds = 0
            if (parts.length === 3) {
                const [h, m, s] = parts
                seconds = Number(h) * 3600 + Number(m) * 60 + parseFloat(s)
            } else if (parts.length === 2) {
                const [m, s] = parts
                seconds = Number(m) * 60 + parseFloat(s)
            } else {
                seconds = parseFloat(clean)
            }
            if (Number.isNaN(seconds)) return undefined

            return Math.round(seconds)
        }

        const mapping = this.route.details.video?.mappings
        const frames = mapping?.length>0 ? Math.max( ...mapping.map(m=>m.frame))  : 0
        const framerate = this.route.details?.video?.framerate
        const time =  framerate ? Math.round(info.frames/framerate) : parseTime(info.timemark);
        const pct = frames ? Math.floor(info.frames/frames *100) : undefined
        const cpu = this.getCpuStats(info)
        
        if (frames||time) {
            this.observer.emit('convert-progress',pct, info.frames, time)
            this.logEvent({message:'video conversion progress',pct,frames:{converted:info.frames, total: frames},time, ffmpegTime:info.timemark, cpu})
        }
        
    }

    protected getCpuStats(info:ConversionInfo) {
        let cpu={};
        if (info.cpu) {
            cpu = {
            cpu: info.cpu.cpu.toFixed(1),
            usr: info.cpu.user.toFixed(1),
            nice: info.cpu.nice.toFixed(1),
            sys: info.cpu.sys.toFixed(1),
            irq: info.cpu.irq.toFixed(1),
            idle: info.cpu.idle.toFixed(1),
            priority: info.priority
            }  
        }

        return cpu
    }

    protected onConvertError (err:Error) {
        this.stop()
        this.logEvent ( {message: 'video conversion error', url:this.url, error:err.message, stack:err.stack})
        this.observer.emit('convert-error',err.message)
    }


    @Injectable
    protected getVideoBindings() {
        return getBindings().video
    }


}