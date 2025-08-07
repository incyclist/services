export type IntervalsConfig = {
    /** access token */
    accessToken:string,  
}


export type IntervalsUploadRequest = {
    /** filename of the file o be uploded */
    file

    /** The desired name of the acitvity in Strava, defaults to name within the payload */
    name: string

    /** The desired description of the resulting activity. */
    description: string

    /** The desired external identifier of the resulting activity. */
    externalId?: string

}

export type IntervalsUploadProps = {
    /** file format ( TCX,FIT,...), needs to be supproted by VeloHero */
    format: IntervalsFormat

    /** The desired name of the acitvity in Strava, defaults to name within the payload */
    name?: string

    /** The desired description of the resulting activity. */
    description?: string

    /** The desired external identifier of the resulting activity. */
    externalId?: string

}


export type IntervalsActivity  ={ 
    /** The athlete identifier of the upload */
    icu_athlete_id: string    

    /** The unique identifier of the upload */
    id: string

}

export type IntervalsUploadResponse  ={
    /** The athlete identifier of the upload */
    icu_athlete_id?: string    

    /** The unique identifier of the upload */
    id?: string

    status?: number

    error?:string

    /** The unique identifier of the upload in string format*/
    activities?: IntervalsActivity[]
}

export type IntervalsUploadResult  = {
    /** The Strava identifier of the qctivity */
    intervalsId?: string

    /** The external (i.e. incyclist) identifier of the upload */
    externalId?: string
}

export type IntervalsAthleteResult = {
    athlete: IntervalsAthlete
    sharedFolders
    customItems
}

export type IntervalsAthlete = {
    id: string
    name: string
    profile_medium: string
    city: string
    state: string
    country: string
    timezone: string
    sex: string
    bio: string
    website: string
    email: string    
}

export type IntervalsCalendarEvent = {
    id: number
    plan_name: string
    name: string
    icu_training_load: number,
    start_date_local: string
    end_date_local: string
    type: 'Ride'|'Run'|'Swim'|'Walk'|'Weight Training'
    calendar_id: number
    uid: string
    athlete_id: string    
    description: string
    indoor: boolean
    moving_time: number
    icu_ftp: number
    atl_days: number
    ctl_days: number
    updated: string
    for_week: boolean
    workout_doc: IntervalsWorkoutDoc
    workout_filename?:string
    workout_file_base64?:string
}

export type IntervalsCalendarRequest = {
    oldest?: Date,
    newest?: Date,
    days?: number,
    ext?: 'zwo'|'mrc'|'erg'|'fit'
}


export class IntervalsWorkoutDoc {
    description: string;
    description_locale?: Record<string, string>;
    locales: string[];
    options: Record<string, string>;
    duration: number;
    distance: number;
    zoneTimes: (number | object)[]; // sometimes array of ints otherwise array of objects
    pace_units: string; // SECS_100M, SECS_100Y, MINS_KM, MINS_MILE, SECS_500M
    steps: IntervalsWorkoutStep[];
}



export type IntervalsWorkoutStep = {
    text: string;
    text_locale: Record<string, string>;
    duration: number;
    distance: number;
    until_lap_press: boolean;
    reps: number;
    warmup: boolean;
    cooldown: boolean;
    intensity: "active" | "rest" | "warmup" | "cooldown" | "recovery" | "interval" | "other";
    steps: IntervalsWorkoutStep[];
    ramp: boolean;
    freeride: boolean;
    maxeffort: boolean;
    power: IntervalsWorkoutValue;
    hr: IntervalsWorkoutValue;
    pace: IntervalsWorkoutValue;
    cadence: IntervalsWorkoutValue;
    hidepower: boolean;

    _power: IntervalsWorkoutValue;  // resolved value (based on FTP)
    _hr: IntervalsWorkoutValue;     // resolved value (based on threshold)
    _pace: IntervalsWorkoutValue;   // resolved value (based on threshold)
    _distance: number;              // resolved value (based on threshold)
};

export type IntervalsWorkoutValue = {
    value: number,
    start: number,
    end: number,
    units: string,
    target: string,
    mmp_duration: number
}



export type IntervalsFormat = 'fit' | 'fit.gz' | 'tcx'  | 'tcx.gz' | 'gpx' | 'gpx.gz'



