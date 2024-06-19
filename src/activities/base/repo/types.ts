import { UploadInfo } from "../model"


export interface ActivitySearchCriteria {
    routeId?: string, 
    routeHash?: string,
    startPos?: number,
    realityFactor?: number,
    uploadStatus?: UploadInfo|Array<UploadInfo>
    isSaved?:boolean
}