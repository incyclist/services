import { ActivityDetails, ActivitySummary } from "../model"

export const buildSummary = (activity:ActivityDetails,proposedName?:string):ActivitySummary =>{
    const {id, title,route,screenshots,startTime: startTimeUTC,time: rideTime,distance,startPos,realityFactor=100,links,laps} = activity

    const name = proposedName ?? activity.name
    const routeId = route?.id
    const routeHash = route?.hash
    const shots = screenshots??[]
    const preview = shots.find( s=>s.isHighlight)??shots[0]
    const previewImage = preview?.fileName

    let startTime:number
    if (startTimeUTC)
        startTime = (new Date(startTimeUTC)).getTime()

    const uploadStatus=[]
    if (links?.strava) {
        uploadStatus.push( {service:'strava',status: 'success'})
    }

    return {
        id,title,name, routeId, routeHash, previewImage,startTime,rideTime,distance,startPos,realityFactor,uploadStatus,laps
    }
}


