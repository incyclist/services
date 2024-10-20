export  * from './kwt'

import { FileInfo } from '../../../api'
import { ParserFactory } from './factory'
import { GPXParser } from './gpx'
import { IncyclistXMLParser } from './incyclist'
import { KWTParser } from './kwt'
import { MultipleXMLParser } from './multixml'
import { ParseResult } from '../types'
import { RouteApiDetail } from '../api/types'
import { BikeLabParser } from './bikelab'
import { EPMParser } from './epm'
import { TacxParser } from './tacx/TacxParser'

export const useParsers = () => {

    // lazy init of parsers
    const parsers = ParserFactory.getInstance()
    if (!parsers.isInitialized()) {
        parsers.add( new MultipleXMLParser([KWTParser,IncyclistXMLParser,BikeLabParser]) )
        parsers.add( new GPXParser() )
        parsers.add( new EPMParser() )
        parsers.add( new TacxParser() )
        parsers.setInitialized(true)
    }
    return parsers;
}


export class RouteParser {
    static async parse (info:FileInfo) : Promise<ParseResult<RouteApiDetail>> {
        const parsers = useParsers();
        
        const formatParsers = parsers.suppertsExtension(info.ext)
        const promises = []
        formatParsers.forEach ( p => {
            const check = async()=> {
                const data = await p.getData(info)
               
                if (p.supportsContent(data))
                    return { parser:p, data}
            }
            promises.push( check())
        })

        const res = await Promise.allSettled(promises) 
        const matching = res.map( promise => promise.status==='fulfilled' ? promise.value:undefined).find(p=>p!==undefined)

        if (matching)
            return await matching.parser.import(info,matching.data)
        else 
            throw new Error('no matching parser found')
        
    }
    
}
