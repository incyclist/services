import { IPageService } from "../../base/pages";
import { ActivityInfoUI } from "../base";

export interface ActivitiesPageDisplayProps {
    loading: boolean;       // indicates that the service is still loading the activities
    activities?: Array<ActivityInfoUI>,
    detailActivityId?: string
}


export interface IActivitiesPageService extends IPageService  {
    getPageDisplayProps():ActivitiesPageDisplayProps
}
