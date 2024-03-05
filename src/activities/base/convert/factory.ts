import { Singleton } from "../../../base/types";
import { ActivityDetails } from "../model";
import { IActivityConverter } from "./types";

/**
 * Factory class responsible for managing converters who are converting activity data into different formats.
 * 
 * @class
 * @public
 * @noInheritDoc
 */
@Singleton
export class ActivityConverterFactory  {

    protected converters:Record<string,IActivityConverter>

    /**
     * Constructs an instance of ActivityConverterFactory.
     * @constructor
     */
    constructor() {
        this.converters = {}
    }

     /**
     * Adds a new activity converter to the factory.
     * @param {string} format - The format of the converter.
     * @param {IActivityConverter} converter - The converter to add.
    */
    add(format:string, converter: IActivityConverter) {
        if (!format || !converter)
            return;

        this.converters[format.toLowerCase()] = converter
    }

    /**
     * Converts an activity to the specified target format.
     * @param {ActivityDetails} activity - The activity to convert.
     * @param {string} targetFormat - The target format to convert the activity to.
     * @returns {Promise<any>} A promise resolving to the converted activity data.
     * @throws {Error} Thrown if activity or targetFormat is not specified, or if targetFormat is unknown.
     */
    async convert(activity:ActivityDetails, targetFormat:string) {
        if (!activity || !targetFormat)
            throw new Error( 'illegal use: activity and format need to be specified')
    
        const format = targetFormat.toLowerCase()
        const converter = this.converters[format]
        if (!converter)
            throw new Error( `unknown format: ${targetFormat}`)

        const res = await converter.convert( activity)
        return res;
    }
}
