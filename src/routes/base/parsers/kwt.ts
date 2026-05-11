import { XMLParser } from './xml';


/**
 * Parser for KWT (Kettler World Tour) route format. Simple extension of XMLParser
 * that inherits all standard XML parsing functionality.
 */
export class KWTParser extends XMLParser{
    static readonly SCHEME = 'kwt'
}

