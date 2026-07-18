/**
 * One zone-colored bar of a workout, over a time band [x0,x).
 *
 * y/y0 are in the unit requested via `WorkoutGraphSeriesOptions.absValues` - either
 * absolute Watts (absValues:true, requires ftp) or %FTP (absValues:false/omitted).
 */
export interface WorkoutGraphPlanBar {
    /** bar start (elapsed time, s) */
    x0: number
    /** bar end (elapsed time, s) */
    x: number
    /** top power - max of the band, or the ramp value at this point */
    y: number
    /** bottom power - min of the band; 0 for single-value steps */
    y0: number
    /** 1..7 -> WORKOUT_ZONE_COLORS[zone]; 0 = uncolored */
    zone: number
}

export interface WorkoutGraphSeriesOptions {
    /** FTP to resolve %FTP-defined steps against; required for absValues and for zone coloring */
    ftp?: number
    /** true: y/y0 are absolute Watts; false/omitted: y/y0 are %FTP */
    absValues?: boolean
}
