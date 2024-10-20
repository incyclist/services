import { Singleton } from "../../../base/types";
import { WorkoutParser } from "./types";

@Singleton
export class WorkoutParserFactory {

    private parsers: Array<WorkoutParser<unknown>> 
    private initialized: boolean;

    constructor() {
        this.parsers = []
        this.initialized = false;
    }

    add( parser:WorkoutParser<unknown>) {
        this.parsers.push(parser)
    }


    suppertsExtension( extension:string) {
        const matching = this.parsers
            .filter( p=>p.supportsExtension(extension))

        if (!matching?.length) 
            throw new Error(`invalid file format ${extension}` )

        return matching
    }


    findMatching( extension:string, data?:unknown ) {
        const matching = this.parsers
            .filter( p=>p.supportsExtension(extension))
            .filter( p=> {
                if (!data)
                    return true;
                return p.supportsContent(data)
            })

        if (!matching?.length) 
            throw new Error(`invalid file format ${extension}` )

        return matching[0]
    }

    isInitialized():boolean {
        return this.initialized
    }

    setInitialized(done:boolean) {
        this.initialized=done
    }

}