import { ActivityDetails } from "../model";

export interface IActivityConverter {
    convert(activity:ActivityDetails)
}

export class ActivityConverter implements IActivityConverter{
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    convert(activity?: ActivityDetails) {
        throw new Error("Method not implemented.");
    }
    
}