/**
 * pauses the execution for a given time
 *
 * @param {number}  ms - the time (in ms) to be paused
 */
export const sleep = async (ms:number) => new Promise<void>( resolve => setTimeout(resolve,ms))
