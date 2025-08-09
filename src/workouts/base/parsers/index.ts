import { FileInfo } from '../../../api'
import { Workout } from '../model/Workout'
import { JsonParser } from './incyclist/Json'
import {WorkoutParserFactory} from './factory'
import { ZwoParser } from './zwo/zwo'
import { IntervalsJsonParser } from './intervals/parser'

const useWorkoutParsers = () => {

    // lazy init of parsers
    const parsers = new WorkoutParserFactory()
    if (!parsers.isInitialized()) {
        parsers.add( new JsonParser() )
        parsers.add( new ZwoParser() )
        parsers.add( new IntervalsJsonParser() )
        parsers.setInitialized(true)
    }
    return parsers;
}


export class WorkoutParser {
    static async parse (info:FileInfo) : Promise<Workout> {
        const parsers = useWorkoutParsers();
        
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
