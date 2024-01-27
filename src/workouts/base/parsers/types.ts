import { FileInfo } from "../../../api"
import { Workout } from "../model/Workout"

export interface WorkoutParser<In> {
    import(file: FileInfo, data?:In): Promise<Workout>
    supportsExtension(extension:string):boolean
    supportsContent(data:In):boolean
    getData(info:FileInfo,data?:In):Promise<In>
}
