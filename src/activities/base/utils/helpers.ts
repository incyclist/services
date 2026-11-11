export * from './activity'
import { ActivityAppLinks, ActivityDetails, ActivitySummary, DEFAULT_ACTIVITY_TITLE, DEFAULT_SPORT_ACTIVITY_TITLE, UploadInfo } from "../model"

export const buildSummary = (activity:ActivityDetails,proposedName?:string):ActivitySummary =>{
    const {id, route,screenshots,startTime: startTimeUTC,time: rideTime,distance,startPos,endPos, realityFactor=100,smoothingLevel,links,laps,fileName} = activity

    let name = proposedName ?? activity.name
    const routeId = route?.id
    const routeHash = route?.hash
    const shots = screenshots??[]
    const preview = shots.find( s=>s.isHighlight)??shots[0]
    const previewImage = preview?.fileName
    const totalElevation = activity.totalElevation
    
    let title = activity.title

    const sport = activity.sport??'cycling'
    if (title=== DEFAULT_ACTIVITY_TITLE || title===DEFAULT_SPORT_ACTIVITY_TITLE[sport])  {
        if (activity.routeType==='Video' && activity.route) 
            title = activity.route.title??activity.route.name
        else if ( activity.route) 
            title = activity.route.name??title
    }

    name = verifyName(name, fileName)

    let startTime:number
    if (startTimeUTC)
        startTime = (new Date(startTimeUTC)).getTime()

    const uploadStatus= buildUploadStatus(links)


    return {
        id,title,name, routeId, routeHash, previewImage,startTime,rideTime,distance,totalElevation, startPos,endPos,realityFactor,smoothingLevel,uploadStatus,laps
    }
}

export const buildUploadStatus = (links?:ActivityAppLinks ):UploadInfo[] =>  {
    const uploadStatus=[]

    if (links) {
        const services = Object.keys(links)
        for (const service of services) {

            if (links[service]) {
                const status =   links[service]
                

                uploadStatus.push( {service,status: status.error ? 'failed' : 'success'})
            }
        }
    }

    return uploadStatus
}

const verifyName = (name:string, fileName:string) => {
    if (name===undefined && fileName!==undefined) {
        const parts = fileName.split(/[/\\]/)

        const last = parts.at(-1)
        if (last?.endsWith('.json'))
            name = last.slice(0, -5)

    }
    return name

}


export const getActivityTotalElevation = (activity:ActivityDetails):number => {
    const{logs=[]} = activity

    let elevation = 0
    let prevElevation
    logs.forEach( log => {
        if (prevElevation!==undefined && log.elevation>prevElevation)  
            elevation += log.elevation - prevElevation
        prevElevation = log.elevation
    })

    return elevation

}
