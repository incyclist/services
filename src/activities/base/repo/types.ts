import { UploadInfo } from "../model"


export interface ActivitySearchCriteria {
    routeId?: string, 
    routeHash?: string,
    startPos?: number,
    endPos?: number,
    realityFactor?: number,
    uploadStatus?: UploadInfo|Array<UploadInfo>
    isSaved?:boolean,
    minTime?:number,
    minDistance?:number
    maxValues?:number
}