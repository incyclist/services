import { UploadInfo } from "../model"


export interface ActivitySearchCriteria {
    routeId?: string, 
    startPos?: number,
    realityFactor?: number,
    uploadStatus?: UploadInfo|Array<UploadInfo>
    isSaved?:boolean
}