import { ActivityInfo, DEFAULT_ACTIVITY_TITLE } from "../../model";
import { ActivitiesDBMigrator, MigrationResult } from "./types";

export class MigrationV3 extends ActivitiesDBMigrator{
    migrate(activity: ActivityInfo): MigrationResult {
        const {summary,details} = activity

        let detailsChanged = false

        if (details.routeType==='Video' && details.route) {
            const route = this.getRouteList().getRouteDescription(details.route.id)
            if (route?.title) {
                details.route.title = route.title
                detailsChanged = true
            }
        }

        if (summary.title=== DEFAULT_ACTIVITY_TITLE)  {
            if (details.routeType==='Video' && details.route) 
                summary.title = details.route.title
            else if ( details.route) 
                summary.title = details.route.name


        }
        summary.totalElevation = details.totalElevation
        

        return {detailsChanged,summaryChanged: true}

    }
}