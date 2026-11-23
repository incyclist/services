/**
 * Returns if the argument is a valid object, i.e. does not equal null or undefined and can be stringified
 *
 * @param {Object}  v - argument 
 */
export function valid(v) {
    if ( v===undefined || v===null)
        return false;
    try {JSON.stringify(v)} catch {
        return false
    }
    return true;
}


/**
 * Returns true only for a number greater than zero; `undefined`, `null` and `NaN` are not positive.
 *
 * @param v - the value to check
 */
export const isPositive = (v: unknown): boolean => typeof v === 'number' && v > 0
