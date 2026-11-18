import { PowerLimit } from '../../model/types'

/** Result of the conversion of the primary target of a TrainerDay segment */
export type PowerResult = { power?: PowerLimit, ramp: false | 'up' | 'down' }
