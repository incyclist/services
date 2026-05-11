import { FileInfo, getBindings } from "../../../api";
import { RouteApiDetail } from "../api/types";
import { XmlJSON, parseXml } from "../../../utils/xml";
import { XMLParser } from "./xml";

import type  { ParseResult, Parser } from "./types";
import { getUtf8Data } from "./utils";

/**
 * Parser for handling multiple XML file formats. Delegates to the appropriate specialized XML parser
 * based on the content structure of the XML file.
 */
export class MultipleXMLParser implements Parser<XmlJSON,RouteApiDetail> {

    protected parsers

    /**
     * Creates a new MultipleXMLParser with the provided parser classes.
     * @param classes Array of XMLParser class constructors to instantiate and use for parsing
     */
    constructor( classes: Array<typeof XMLParser>) {
        this.parsers = []
        classes.forEach( C => {
            const parser = new C()
            this.parsers.push(parser)
        })

    }
    /**
     * Imports XML data from a file or provided data object, using the appropriate parser.
     * @param file File information including path and metadata
     * @param data Optional pre-parsed XML data. If provided, this is used instead of loading from file
     * @returns Promise resolving to the parsed route data and any import results
     * @throws Error if file cannot be opened or no suitable parser is found
     */
    async import(file:FileInfo, data?: XmlJSON): Promise<ParseResult<RouteApiDetail>> {
        const xmlJson = await this.getData(file,data)
        const parser = this.parsers.find( p=> p.supportsContent(xmlJson))
        return await parser.import(file,xmlJson)

    }
    /**
     * Checks if this parser supports the given file extension.
     * @param extension File extension to check (case-insensitive)
     * @returns true if the extension is 'xml', false otherwise
     */
    supportsExtension(extension: string): boolean {
        return extension?.toLowerCase()==='xml'
    }
    /**
     * Returns the primary file extension supported by this parser.
     * @returns 'xml'
     */
    getPrimaryExtension(): string {
        return 'xml'
    }
    /**
     * Returns companion file extensions that may be associated with XML files.
     * @returns Empty array as XML files typically do not have companion files
     */
    getCompanionExtensions(): string[]    {
        return []
    }


    /**
     * Checks if this parser supports the given XML content.
     * @returns true as this parser supports all XML content by delegating to specialized parsers
     */
    supportsContent(): boolean {
        return true
    }

    /**
     * Retrieves XML data from a file or returns provided data.
     * @param info File information including path and metadata
     * @param data Optional pre-parsed XML data. If provided, this is returned directly
     * @returns Promise resolving to the parsed XML as JSON
     * @throws Error if the file cannot be opened or XML parsing fails
     */
    async getData(info:FileInfo,data?:XmlJSON): Promise<XmlJSON> {
        if (data)
            return data

        const loader = getBindings().loader
        const res = await loader.open(info)
        if (res.error) {
            throw new Error('Could not open file')
        }
        const cleaned = getUtf8Data(res.data)

        const xml = await parseXml(cleaned)
        return xml
    }

}
