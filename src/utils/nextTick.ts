/**
 * pauses the execution until the event queue has been processed
 *
 */
export const waitNextTick = async () => new Promise<void>( resolve => process.nextTick(resolve))
