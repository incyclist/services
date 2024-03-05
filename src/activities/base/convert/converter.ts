import { ActivityDetails } from "../model";
import { ActivityConverterFactory } from "./factory";
import { RemoteFitConverter } from "./fit";
import { TcxConverter } from "./tcx";

// lazy initialisation of converters

export class ActivityConverter {
    static factory: ActivityConverterFactory
   
        
    static async convert (activity:ActivityDetails,format:string) : Promise<unknown> {
        
        if (!ActivityConverter.factory) {
            ActivityConverter.factory = new ActivityConverterFactory()
            ActivityConverter.factory.add('fit',new RemoteFitConverter())
            ActivityConverter.factory.add('tcx', new TcxConverter())
        }

        return await ActivityConverter.factory.convert(activity,format)        
    }
    
}
