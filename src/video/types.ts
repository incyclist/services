export type RLVPlaybackStatus = {
    /** current plabnack rate */
    rate: number
    rateRequested?: number
    tsLastRateRequest?: number

    /** current playback time of mediasource */
    time: number
    timeRequested?: number
    tsLastTimeRequest?: number

    /** position of video playback in the route */
    routeDistance: number   

    /** recording speed */
    speed: number;          

    /** ts of last update*/
    ts: number,
    tsVideoUpdate?: number
    tsResume?: number

    lap: number
    lapRequested?: boolean

    isStalled?: boolean    
    tsStalled?: number
}

export type RLVActivityStatus = {
    /** current rider position in the route */
    routeDistance: number

    /** current rider speed */
    speed: number;          
    
    /** ts of last update*/
    ts: number,

    lap: number
}

export type ConversionCpuInfo = {
    cpu?: number,
    user?:number,
    nice?: number,
    sys?: number,
    irq?:number,
    idle?: number,
    ts?:number
}

export type ConversionInfo = {
    target: number,
    current: number,
    completed: number,
    frames: number,
    timemark?:string,
    cpu?: ConversionCpuInfo
    priority?:number

}