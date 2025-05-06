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


const MAX_LOOKUP = 100

const isJump = (v1,v2)=> {
    if (v2===v1 || v1<0.2 || v2<0.2)
        return false

    return (Math.abs(v2-v1) >3) ||
        (v2>v1* 1.4  && Math.abs(v2-v1)>2)

}

export const calculateSpeed  = ( points:RoutePoint[], idx:number) => {
    const p = points?.[idx]
    if(!p || idx===0)return 

    const t = idx === 0 || !p.time ? 0 : p.time- points[idx - 1].time
    const speed = idx === 0 ? 0 : p.distance / (t ?? 1)
    return speed

}

export const getPointsWithSpeed= (points:RoutePoint[]):RoutePointEval[] => {
    return points.map((p, idx) => {
        const d: RoutePointEval = { ...p }
        d.speed = calculateSpeed(points,idx)
        return d
    })
}

export const detectAnomalies = (points: RoutePoint[], maxCount?:number) => {

    if (points[0].time===undefined)
        return []

    const data = getPointsWithSpeed(points)


    // detect records in data where speed has jumped more than 50% compared to previous (minimum 5m/s)
    // for those cases, check if previous point had speed === 0
    // if previous point has speed = 0, then add previous point to anomalies (type "noDistance") otherwise add current point (type "speedJump")
    // for calculation of the next record, use last record with speed > 0
    const anomalies: Anomaly[] = [];
    let lastValidSpeedIdx = 0;
    let done = false


    const isSpeedJump = (p1,p2) => {
        return isJump(p1.speed, p2.speed)
                 
    }

    const isCloseToNull = (p) => {
        return (p.distance<0.5 || p.speed<0.5)
    }

    const onNullValueDetected = (point:RoutePointEval, idx:number) => {

        // we might be at very low speed, lets check if half of prev speed would fit
        const speedPrev = data[idx-1].speed

        if (speedPrev<2)
            return

        const speedNext = data[idx+1].speed
        if (speedPrev>speedNext && !isJump(speedPrev/2,speedNext)) {
            anomalies.push({ idx:idx-1, type: 'speedJump', point, nextNullIdx:idx })
        }

        let nextJumpIdx;
        const idxPrev = lastValidSpeedIdx === 0 ? idx - 1 : lastValidSpeedIdx;
        for (let j = idx + 1; j < idx + MAX_LOOKUP && nextJumpIdx === undefined; j++) {

            if (isSpeedJump(data[idxPrev], data[j])) {
                nextJumpIdx = j;
            }

        }   
        anomalies.push({ idx, type: 'noDistance', point, nextJumpIdx });
    }

    const onSpeedJumpDetected = (point:RoutePointEval, idx:number)=> {
        const prevPoint = data[lastValidSpeedIdx];
        let nextJumpIdx,nextNullIdx

        if (prevPoint.speed === 0) {
            anomalies.push({ idx: lastValidSpeedIdx, type: 'noDistance',point});
        } else {
            
            // two jumps in a row (UP->DOWN or DOWN->UP)
            // if ( !isCloseToNull(data[idx+1])
            //     &&  isSpeedJump(point, data[idx+1])      
            //     && (isSpeedJump(data[idx-1], data[idx+1]) || (!isCloseToNull(data[idx+2]) && isSpeedJump(data[idx+1], data[idx+2]) ))
                
            //     && (data[idx+1].speed<0.7*point.speed) || (point.speed<0.7*data[idx+1].speed) ){
            //         nextJumpIdx = idx+1

            // }
            // else { // check if the jump is followed by a record with distance/speed close to 0
                let nextJumpFound = false
                for (let j=idx+1; j<idx+MAX_LOOKUP && !nextJumpFound && nextNullIdx===undefined; j++) {            
                    // if we find a speed jump before finding the next null value, then interrupt
                    if ( isCloseToNull(data[j])) {
                        nextNullIdx = j
                    }
                    else if ( j>idx+1 && isSpeedJump(data[j], data[j-1])) {
                        nextJumpFound = true
                        continue
                    }

                }
            // }
            anomalies.push({ idx, type: 'speedJump',point, nextNullIdx,nextJumpIdx  });
        }

    }

    data.forEach((point, idx) => {
        if (idx === 0 || done) return;
   
        if (point.speed===0 || point.distance===0) {
            onNullValueDetected(point,idx);
        }
        else if (isSpeedJump(data[lastValidSpeedIdx],point)) {            
            onSpeedJumpDetected(point,idx)
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
   

    if (anomaly.type==='speedJump') {
        fixSpeedJump(anomaly, points);
    }

    else if (anomaly.type==='noDistance') {
        fixNoDistance(anomaly, points);
    }

}

export const fixAnomalies= (points: RoutePoint[], maxAttempts:number=1000) => { 
    let fixed = 0
    let anomalies = []
    let tsStart = Date.now()
    let prev:Anomaly
    let stuck = false
    let error 
    let retry = 0

    const fixedRecords:Anomaly[] = []
    try {
   
        do {
            anomalies = detectAnomalies(points,1)

            if (anomalies.length>0) {            

                const current = anomalies[0]
                if (prev?.idx===current.idx && ++retry>5) {
                    stuck = true
                    continue
                }
                else {
                    retry = 0
                    if (prev?.type===current.type && prev?.type==='speedJump' && current.idx>prev?.idx && current.idx<prev?.nextNullIdx) {
                        // prev fix has not completely fixed the issue
                        current.nextNullIdx = prev.nextNullIdx
                        current.retry = (prev.retry??0)+1
                    }
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


const fixNoDistance = (anomaly: Anomaly, points: RoutePoint[]) =>{
    const idx = anomaly.idx;

    const next = points?.[idx + 1];
    const prev = points?.[idx - 1];


    const fixNullWithoutJump  = () =>{
        if (idx > 2 && idx < points.length - 2) {
            const s = points[idx + 2].routeDistance - points[idx - 2].routeDistance;
            const t = points[idx + 2].time - points[idx - 2].time;
            const avgSpeed = s / t;
            const nextSpeed = calculateSpeed(points, idx + 1);
            const prevSpeed = calculateSpeed(points, idx - 1);


            if ((Math.abs(prevSpeed - avgSpeed) - Math.abs(nextSpeed - avgSpeed)) > 0.5) {
                points[idx].distance = points[idx].routeDistance - points[idx - 2].routeDistance;
                points.splice(idx - 1, 1);
            }
            else {
                next.distance = next.routeDistance - prev.routeDistance;
                points.splice(idx, 1);
            }

        }
        else {
            next.distance = next.routeDistance - prev.routeDistance;
            points.splice(idx, 1);

        }
    }

    const fixNullFollowedByJump =() => {
        const endIdx = anomaly.nextJumpIdx;

        const vEnd = calculateSpeed(points, endIdx);
        const vStart = calculateSpeed(points, endIdx - 1);

        if (endIdx === idx + 1) {
            const offset = vEnd / 2;

            const t0 = points[idx].time - points[idx - 1].time;
            const v0 = offset;
            const d0 = v0 * t0;
            points[idx].distance = d0;
            points[idx].routeDistance += d0;

            const t = points[endIdx].time - points[endIdx - 1].time;
            const vPrev = calculateSpeed(points, endIdx);
            const v = vPrev - offset;
            const d = v * t;
            points[endIdx].distance = d;

        }
        else {
            const offset = vEnd - vStart;
            for (let j = anomaly.idx; j < endIdx; j++) {
                const t = points[j].time - points[j - 1].time;
                const vPrev = calculateSpeed(points, j);
                const v = vPrev + offset;
                const d = v * t;
                const dOffset = points[j].distance - d;
                points[j].distance = d;
                points[j].routeDistance += dOffset;
            }
            const t = points[endIdx].time - points[endIdx - 1].time;
            const vPrev = calculateSpeed(points, endIdx);
            const v = vPrev - offset;
            const d = v * t;
            points[endIdx].distance = d;

        }
    }


    if (anomaly.nextJumpIdx !== undefined) {
        // correct speed/distance of values until jump
        fixNullFollowedByJump();
    }
    else {

        fixNullWithoutJump();
    }

}

const fixSpeedJump  = (anomaly: Anomaly, points: RoutePoint[]) => {

    const fixJumpFollowedByNull = () => {
        const idx = anomaly.idx;
        const idxNull = anomaly.nextNullIdx;
        const vIssue = calculateSpeed(points, idx);

        let offset

        if (idx+1===idxNull) {
            offset =vIssue/2
        }
        else {
            //const offset = idxNull===idx+1 ? calculateSpeed(points,idx)/2 : calculateSpeed(points,idxNull-1)
            const vEnd = calculateSpeed(points, idxNull - 1)
            const vStart = calculateSpeed(points, idx - 1)
            let vTarget
            const v1 = vIssue-vStart
            const v2 = vIssue-v1

            if (vStart>vEnd) {
                vTarget = Math.max(v1,v2)
            }
            else {
                vTarget = isJump(v1,v2) ? (v1+v2)/2 : Math.min(v1,v2)
                
            }
            offset = vIssue-vTarget
        }

        // fix speed jump point
        let t = points[idx].time - points[idx - 1].time;
        let v = vIssue - offset;    
        let s = v * t;
        let dOffset = points[idx].distance - s;
        points[idx].distance = s;
        points[idx].routeDistance -= dOffset;

        v = offset

        // fill in the gap into the next record and shift speed,distance and routeDistance for points inbetween
        for (let j = idx + 1; j < idxNull; j++) {
            t = points[j].time - points[j - 1].time;
            s = v*t

            // store the speed for next repetition of loop
            v = offset = calculateSpeed(points, j)

            dOffset = points[j].distance - s;
            points[j].distance = s;
            points[j].routeDistance -= dOffset;
            
        }

        // fix point with null distance
        t = points[idxNull].time - points[idxNull - 1].time;
        v = offset;
        points[idxNull].distance = v * t;
    }

    const fixJumpFollowedByNullRetry =() => {
        const idx = anomaly.idx;
        const idxNull = anomaly.nextNullIdx;

        //const offset = idxNull===idx+1 ? calculateSpeed(points,idx)/2 : calculateSpeed(points,idxNull-1)
        let offset;


        if (idxNull === idx + 1) { // 
            offset = (calculateSpeed(points, idx) - calculateSpeed(points, idxNull)) / 2;

            const t = points[idx].time - points[idx - 1].time;
            const vPrev = calculateSpeed(points, idx);
            const v = vPrev - offset;
            const d = v * t;
            const dOffset = points[idx].distance - d;
            points[idx].distance = d;
            points[idx].routeDistance -= dOffset;

            const t0 = points[idxNull].time - points[idxNull - 1].time;
            const v0 = offset;
            points[idxNull].distance += v0 * t0;


        }
    }

    const fixJumpFollowedByJump = ()=> {
        const idx = anomaly.idx;

        const current = points?.[idx];
        const next = points?.[idx + 1];

        const v = (calculateSpeed(points, idx)+calculateSpeed(points, idx+1))/2
        const t = points[idx].time - points[idx - 1].time;
        const d = v * t;
        const offset = current.distance-d

        current.distance = d
        current.routeDistance -= offset
        next.distance+=offset

    }

    if (anomaly.nextNullIdx !== undefined && anomaly.retry > 0) {
        fixJumpFollowedByNullRetry();
    }
    else if (anomaly.nextNullIdx !== undefined ) {
        fixJumpFollowedByNull();
    }
    else if (anomaly.nextJumpIdx!==undefined) {
        fixJumpFollowedByJump();
    }
    else {
        const idx = anomaly.idx;

        const next = points?.[idx + 1];
        const prev = points?.[idx - 1];
        if (next && prev) {
            next.distance = next.routeDistance - prev.routeDistance;
        }
        points.splice(idx, 1);

    }

}
