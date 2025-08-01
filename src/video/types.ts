export type RLVPlaybackStatus = {
    /** current plabnack rate */
    rate: number
    rateRequested?: number
    /** current playback time of mediasource */
    time: number
    timeRequested?: number

    /** position of video playback in the route */
    routeDistance: number   

    /** recording speed */
    speed: number;          

    /** ts of last update*/
    ts: number,

    lap: number
    lapRequested?: boolean
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