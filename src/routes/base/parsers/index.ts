export  * from './kwt'

import { ParserFactory } from './factory'
import { KWTParser } from './kwt'

export const useParsers = () => {

    // lazy init of parsers
    const parsers = ParserFactory.getInstance()
    if (!parsers.isInitialized()) {
        parsers.add( new KWTParser() )
        parsers.setInitialized(true)
    }
    return parsers;
}
