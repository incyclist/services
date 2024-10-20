
/** convert numeric (signed) degrees to radians */
export function rad( num ) {
    return num * Math.PI / 180;
}

/** convert radians to numeric (signed) degrees */
export function degrees( num ) {
    return num * 180 / Math.PI;
}

/* calculates the sinus from a value specified in degrees 
    Note: Math.sin() calculates the sinus of a value specified in radians
*/
export function sin(degree) {
    return Math.sin( rad(degree) )
}

/* calculates the arcsine from a number as degrees 
    Note: Math.asin() calculates the arcsine of a number, but returns in radians
*/
export function asin(num) {
    const a = Math.asin(num)
    return degrees(a);
}

/* calculates the cosinus from a value specified in degrees 
    Note: Math.cos() calculates the cosinus of a value specified in radians
*/
export function cos(degree) {
    return Math.cos( rad(degree) )
}


export function abs(num) {
    return Math.abs(num)
}