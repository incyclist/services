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

export type IntervalsFormat = 'fit' | 'fit.gz' | 'tcx'  | 'tcx.gz' | 'gpx' | 'gpx.gz'



