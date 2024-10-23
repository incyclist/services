import { FileInfo, getBindings } from "../../../api";
import { RouteApiDetail } from "../api/types";
import { ParseResult, Parser } from "../types";
import { XmlJSON, parseXml } from "../../../utils/xml";
import { XMLParser } from "./xml";

export class MultipleXMLParser implements Parser<XmlJSON,RouteApiDetail> {

    protected parsers

    constructor( classes: Array<typeof XMLParser>) {
        this.parsers = []
        classes.forEach( C => {
            const parser = new C()
            this.parsers.push(parser)
        })

    }
    async import(file:FileInfo, data?: XmlJSON): Promise<ParseResult<RouteApiDetail>> {       
        const xmlJson = await this.getData(file,data)
        const parser = this.parsers.find( p=> p.supportsContent(xmlJson))
        return await parser.import(file,xmlJson)

    }
    supportsExtension(extension: string): boolean {
        return extension?.toLowerCase()==='xml'
    }
    supportsContent(): boolean {
        return true
    }

    async getData(info:FileInfo,data?:XmlJSON): Promise<XmlJSON> {
        if (data)
            return data

        const loader = getBindings().loader
        const res = await loader.open(info)
        if (res.error) {
            throw new Error('Could not open file')
        }
        const xml = await parseXml(res.data)
        return xml
    }


}