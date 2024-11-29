export * from './activity'
import { ActivityDetails, ActivitySummary, DEFAULT_ACTIVITY_TITLE } from "../model"

export const buildSummary = (activity:ActivityDetails,proposedName?:string):ActivitySummary =>{
    const {id, route,screenshots,startTime: startTimeUTC,time: rideTime,distance,startPos,endPos, realityFactor=100,links,laps,fileName} = activity

    let name = proposedName ?? activity.name
    const routeId = route?.id
    const routeHash = route?.hash
    const shots = screenshots??[]
    const preview = shots.find( s=>s.isHighlight)??shots[0]
    const previewImage = preview?.fileName
    const totalElevation = activity.totalElevation
    
    let title = activity.title

    if (title=== DEFAULT_ACTIVITY_TITLE)  {
        if (activity.routeType==='Video' && activity.route) 
            title = activity.route.title??activity.route.name
        else if ( activity.route) 
            title = activity.route.name??title
    }

    if (name===undefined && fileName!==undefined) {
        const parts = fileName.split(/[\/\\]/)

        const match  = /([^\\/]+)\.json/.exec(parts[parts.length-1])
        if (match && match[1]) 
            name = match[1]
        
    }

    let startTime:number
    if (startTimeUTC)
        startTime = (new Date(startTimeUTC)).getTime()

    const uploadStatus=[]
    if (links?.strava) {
        uploadStatus.push( {service:'strava',status: 'success'})
    }

    return {
        id,title,name, routeId, routeHash, previewImage,startTime,rideTime,distance,totalElevation, startPos,endPos,realityFactor,uploadStatus,laps
    }
}


export const getTotalElevation = (activity:ActivityDetails):number => {
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
