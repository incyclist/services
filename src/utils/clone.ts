/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Clones the content of the object ( excluding functions )
 *
 * @param   obj - Object to be cloned 
 */
export default function clone(obj:any):any {
    return JSON.parse(JSON.stringify(obj))
}