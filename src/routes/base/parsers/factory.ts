import { Parser } from "../types"

export class ParserFactory {

    static _instance: ParserFactory

    static getInstance():ParserFactory {
        if (!ParserFactory._instance)
            ParserFactory._instance = new ParserFactory()
        return ParserFactory._instance
    }

    private parsers: Array<Parser<unknown,unknown>> 
    private initialized: boolean;


    constructor() {
        this.parsers = []
        this.initialized = false;
    }

    add( parser:Parser<unknown,unknown>) {
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