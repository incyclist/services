import { RoutePoint } from "../types";

interface RoutePointEval extends RoutePoint {
    speed?: number
}

type AnomalyType = 'speedJump' | 'noDistance'

interface Anomaly {
    idx: number
    type: AnomalyType
    point: RoutePointEval
    nextJumpIdx?: number
    nextNullIdx?:number
    retry?:number
}

const MAX_LOOKUP = 50

export const calculateSpeed  = ( points:RoutePoint[], idx:number) => {
    const p = points?.[idx]
    if(!p || idx===0)return 

    const t = idx === 0 || !p.time ? 0 : p.time- points[idx - 1].time
    const speed = idx === 0 ? 0 : p.distance / (t ?? 1)
    return speed

}

export const detectAnomalies = (points: RoutePoint[], maxCount?:number) => {

    if (points[0].time===undefined)
        return []

    const data = points.map((p, idx) => {
        const d: RoutePointEval = { ...p }
        d.speed = calculateSpeed(points,idx)
        return d
    })

    

    // detect records in data where speed has jumped more than 50% compared to previous (minimum 5m/s)
    // for those cases, check if previous point had speed === 0
    // if previous point has speed = 0, then add previous point to anomalies (type "noDistance") otherwise add current point (type "speedJump")
    // for calculation of the next record, use last record with speed > 0
    const anomalies: Anomaly[] = [];
    let lastValidSpeedIdx = 0;
    let done = false

    const isSpeedJump = (p1,p2) => {
        return p2.speed && p1.speed && 
        p2.speed > p1.speed * 1.5  && p2.speed > 2 ||
        Math.abs(p2.speed - p1.speed) >3         
    }

    data.forEach((point, idx) => {
        if (idx === 0 || done) return;

        if (point.speed===0 || point.distance===0) {

            let nextJumpIdx
            const idxPrev = lastValidSpeedIdx===0 ? idx-1 : lastValidSpeedIdx
            for (let j=idx+1; j<idx+MAX_LOOKUP && nextJumpIdx===undefined; j++) {
                
                if (isSpeedJump( data[idxPrev], data[j] )) {
                    nextJumpIdx = j
                }

            }

            anomalies.push({ idx, type: 'noDistance',point, nextJumpIdx });
            
        }

        const prevPoint = data[lastValidSpeedIdx];
        const speedJump = isSpeedJump(prevPoint,point)

        if (speedJump) {
            if (prevPoint.speed === 0) {
                anomalies.push({ idx: lastValidSpeedIdx, type: 'noDistance',point});
            } else {
                let nextNullIdx
                for (let j=idx+1; j<idx+MAX_LOOKUP && nextNullIdx===undefined; j++) {
                
                    if (data[j].distance<0.5 || data[j].speed<0.5 ) {
                        nextNullIdx = j
                    }
    
                }
                anomalies.push({ idx, type: 'speedJump',point, nextNullIdx  });
            }
        }

        if (!!maxCount && anomalies.length>maxCount-1) {
            done = true;
            return            
        }

        if ((point.speed??0) > 0) {
            lastValidSpeedIdx = idx;
        }
    });

    return anomalies;
}

export const fixAnomaly  = ( anomaly:Anomaly, points: RoutePoint[]) => {
    
//    console.log('fixing', anomaly.type, anomaly.idx, anomaly.point.cnt, {nextJump:anomaly.nextJumpIdx, nextNull:anomaly.nextNullIdx })

    // if (anomaly.idx!=anomaly.point.cnt)
    //     process.exit()

    if (anomaly.type==='speedJump') {

        if (anomaly.nextNullIdx!==undefined && anomaly.retry>0) { 
            const idx = anomaly.idx
            const idxNull = anomaly.nextNullIdx

            //const offset = idxNull===idx+1 ? calculateSpeed(points,idx)/2 : calculateSpeed(points,idxNull-1)

            let offset


            if (idxNull===idx+1) { // 
                offset = (calculateSpeed(points,idx)-calculateSpeed(points,idxNull))/2

                const t = points[idx].time-points[idx-1].time
                const vPrev =  calculateSpeed(points,idx)
                const v = vPrev-offset
                const d = v*t
                const dOffset = points[idx].distance -d;
                points[idx].distance = d
                points[idx].routeDistance -=dOffset

                const t0 = points[idxNull].time-points[idxNull-1].time
                const v0 = offset
                points[idxNull].distance+= v0*t0
        

            }
            else { // linear adjustment of speed correction
                
                const offsetEnd = calculateSpeed(points,idxNull-1)- calculateSpeed(points,idx-1)
                const offsetStart = calculateSpeed(points,idx)-calculateSpeed(points,idx-1)
                const offsetAverage = (offsetStart+offsetEnd)/2

                
    
            }




        }

        if (anomaly.nextNullIdx!==undefined) { 
            const idx = anomaly.idx
            const idxNull = anomaly.nextNullIdx

            //const offset = idxNull===idx+1 ? calculateSpeed(points,idx)/2 : calculateSpeed(points,idxNull-1)

            const offsetNext = idxNull===idx+1 ? calculateSpeed(points,idx)/2 : calculateSpeed(points,idxNull-1)
            const offsetPrev = idxNull===idx+1 ? offsetNext : calculateSpeed(points,idx)- calculateSpeed(points,idx-1)
            const offset = (offsetNext+ offsetPrev)/2


            // fix speed jump point
            const t = points[idx].time-points[idx-1].time
            const vPrev =  calculateSpeed(points,idx)
            const v = vPrev-offset
            const d = v*t
            const dOffset = points[idx].distance -d;
            points[idx].distance = d
            points[idx].routeDistance -=dOffset

            // adjust routeDistance for points inbetween
            for (let j=idx+1; j<idxNull; j++) {
                points[j].routeDistance -=dOffset
            }

            // fix point with null distance
            const t0 = points[idxNull].time-points[idxNull-1].time
            const v0 = offset

            points[idxNull].distance = v0*t0

        }
        else {
            const idx = anomaly.idx

            const next = points?.[idx+1];
            const prev = points?.[idx-1];
            if (next&&prev) {
                next.distance = next.routeDistance-prev.routeDistance
            }
            points.splice(idx,1)
    
        }

    }

    else if (anomaly.type==='noDistance') {
        const idx = anomaly.idx

        const next = points?.[idx+1];
        const prev = points?.[idx-1];

        if (anomaly.nextJumpIdx!==undefined) {
            // correct speed/distance of values until jump
            const endIdx = anomaly.nextJumpIdx

            const vEnd = calculateSpeed(points,endIdx)
            const vStart = calculateSpeed(points,endIdx-1)

            if ( endIdx===idx+1) {
                const offset = vEnd /2

                const t0 = points[idx].time-points[idx-1].time
                const v0 = offset
                const d0 = v0*t0
                points[idx].distance = d0
                points[idx].routeDistance += d0

                const t = points[endIdx].time-points[endIdx-1].time
                const vPrev =  calculateSpeed(points,endIdx)
                const v = vPrev-offset
                const d = v*t
                points[endIdx].distance = d           

            }
            else {
                const offset = vEnd - vStart
                for (let j=anomaly.idx; j<endIdx; j++) {
                    const t = points[j].time-points[j-1].time
                    const vPrev =  calculateSpeed(points,j)
                    const v = vPrev+offset
                    const d = v*t
                    const dOffset = points[j].distance -d;
                    points[j].distance = d
                    points[j].routeDistance +=dOffset
                }
                const t = points[endIdx].time-points[endIdx-1].time
                const vPrev =  calculateSpeed(points,endIdx)
                const v = vPrev-offset
                const d = v*t
                points[endIdx].distance = d           
    
            }

        }
        else {

            if (idx>2 && idx<points.length-2) {
                const s = points[idx+2].routeDistance - points[idx-2].routeDistance
                const t = points[idx+2].time - points[idx-2].time
                const avgSpeed = s/t;
                const nextSpeed = calculateSpeed(points, idx+1)
                const prevSpeed = calculateSpeed(points, idx-1)


                if ( (Math.abs(prevSpeed-avgSpeed)-Math.abs(nextSpeed-avgSpeed))>0.5 ) {
                    points[idx].distance = points[idx].routeDistance-points[idx-2].routeDistance
                    points.splice(idx-1,1)        
                }
                else {
                    next.distance = next.routeDistance-prev.routeDistance
                    points.splice(idx,1)        
                }

            }
            else {
                next.distance = next.routeDistance-prev.routeDistance
                points.splice(idx,1)        

            }
        }


    }

}

export const fixAnomalies= (points: RoutePoint[], maxAttempts:number=1000) => { 
    let fixed = 0
    let anomalies = []
    let tsStart = Date.now()
    let prev:Anomaly
    let stuck = false
    let error 

    const fixedRecords:Anomaly[] = []
    try {
   
        do {
            anomalies = detectAnomalies(points,1)
            if (anomalies.length>0) {            
                const current = anomalies[0]
                if (prev?.idx===current.idx) {
                    stuck = true
                    continue
                }
                else if (prev?.type===current.type && prev?.type==='speedJump' && current.idx>prev?.idx && current.idx<prev?.nextNullIdx) {
                    // prev fix has not completely fixed the issue
                    current.nextNullIdx = prev.nextNullIdx
                    current.retry = (prev.retry??0)+1
                }

                fixAnomaly(anomalies[0],points)            
                fixedRecords.push(anomalies[0])
                prev = anomalies[0]
                fixed++
            }

        }
        while (anomalies.length>0 && fixed<maxAttempts && !stuck)
        points.forEach( (p,idx)=> {p.cnt = idx} ) 
    }
    catch (err) {
        error = err
    }

    let tsStop = Date.now()

    return {fixed, time: tsStop-tsStart, fixedRecords,error}

}



const detectCuts = (points: RoutePoint[]) => {

}