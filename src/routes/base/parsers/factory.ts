import type { Parser } from "./types"

/**
 * Factory for managing and selecting parser instances. Implements the singleton pattern
 * to provide a centralized registry of available parsers and methods to find the appropriate
 * parser for a given file format and content.
 */
export class ParserFactory {

    protected static _instance: ParserFactory

    /**
     * Gets or creates the singleton instance of ParserFactory.
     * @returns The ParserFactory singleton instance
     */
    static getInstance():ParserFactory {
        if (!ParserFactory._instance)
            ParserFactory._instance = new ParserFactory()
        return ParserFactory._instance
    }

    private readonly parsers: Array<Parser<unknown,unknown>>
    private initialized: boolean;


    constructor() {
        this.parsers = []
        this.initialized = false;
    }

    /**
     * Registers a parser with the factory.
     * @param parser The parser instance to register
     */
    add( parser:Parser<unknown,unknown>) {
        this.parsers.push(parser)
    }

    /**
     * Finds all parsers that support the given file extension.
     * @param extension The file extension to search for
     * @returns Array of parsers that support the extension
     * @throws Error if no parsers support the given extension
     */
    suppertsExtension( extension:string) {
        const matching = this.parsers
            .filter( p=>p.supportsExtension(extension))

        if (!matching?.length)
            throw new Error(`invalid file format ${extension}` )

        return matching
    }

    /**
     * Checks if the given extension is a primary extension for any registered parser.
     * @param extension The file extension to check
     * @returns True if the extension is a primary extension for at least one parser, false otherwise
     */
    isPrimaryExtension(extension: string): boolean {
        const ext = extension.toLowerCase()
        const isPrimary = this.parsers.some( p=> p.getPrimaryExtension()===ext)
        return isPrimary
    }

    /**
     * Finds the first parser that supports both the given file extension and content.
     * If data is not provided, returns the first parser supporting the extension.
     * @param extension The file extension to match
     * @param data Optional data to validate against parser's supportsContent method
     * @returns The matching parser instance
     * @throws Error if no parser matches the extension and content criteria
     */
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

    /**
     * Checks if the factory has been initialized.
     * @returns True if initialized, false otherwise
     */
    isInitialized():boolean {
        return this.initialized
    }

    /**
     * Sets the initialization state of the factory.
     * @param done True to mark as initialized, false otherwise
     */
    setInitialized(done:boolean) {
        this.initialized=done
    }

    protected reset() {
        ParserFactory._instance = undefined

    }

}
