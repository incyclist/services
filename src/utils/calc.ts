import {calc} from 'incyclist-devices'

export const calculateSpeedAndDistance = (power:number, slope:number ,vPrev:number=0,  m:number=85 , t:number=0, props= {}): {speed:number, distance:number}  => { 

    const EkinPrev = 1/2*m*vPrev*vPrev;
            
    const powerToMaintainSpeed = calc.calculatePower(m,vPrev,slope,props);

    //no update for more than 30s - we need to reset
    if (t>=30) {
        const speed = calc.calculateSpeed(m,power,slope,props)            
        return { speed,distance:0}
    }

    const powerDelta = powerToMaintainSpeed - power;
    const Ekin = EkinPrev-powerDelta*t;
    if (Ekin>0) {
        const v = Math.sqrt(2*Ekin/m);
        const speed = v*3.6;
        const distance = v*t;

        return {speed,distance}
    }
    else {
        // Power is not sufficiant to keep moving
        const v = vPrev *0.5;
        const speed = v*3.6;
        const distance = v*t;
        return {speed,distance}

    }
}

export const calculatePowerAndDistance = (speed:number, slope:number, vPrev:number=0, m:number=85, t:number=0, props= {}) => { 

    const EkinPrev = 1/2*m*vPrev*vPrev;
    const vTarget = (speed||0) /3.6;
    const Ekin = 1/2*m*vTarget*vTarget;

    const powerDelta = t!==0 ? (EkinPrev - Ekin)/t : 0;
    const powerToMaintainSpeed = calc.calculatePower(m,vPrev,slope,props);
    const power = powerToMaintainSpeed - powerDelta;
    
    const v = speed/3.6
    const distance = v*t;

    return {power,distance}

}


