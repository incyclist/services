export type RLVPlaybackStatus = {
    /** current plabnack rate */
    rate: number
    /** current playback time of mediasource */
    time: number

    /** position of video playback in the route */
    routeDistance: number   

    /** recording speed */
    speed: number;          

    /** ts of last update*/
    ts: number,

    lap: number
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