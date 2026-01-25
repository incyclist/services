import { FormattedNumber } from "../../../i18n"
import { UploadInfo } from "../model"


export interface ActivitySearchCriteria {
    routeId?: string, 
    routeHash?: string,
    startPos?: number|FormattedNumber,
    endPos?: number|FormattedNumber,
    realityFactor?: number,
    uploadStatus?: UploadInfo|Array<UploadInfo>
    isSaved?:boolean,
    minTime?:number,
    minDistance?:number
    maxValues?:number
}