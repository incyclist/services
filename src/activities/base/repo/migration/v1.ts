import { ActivityInfo } from "../../model";
import { ActivitiesDBMigrator, MigrationResult } from "./types";

export class MigrationV1 extends ActivitiesDBMigrator{
    migrate(activity: ActivityInfo): MigrationResult {
        const {details} = activity

        let detailsChanged = false
        if (details.routeType==='Video' && details.route) {
            const route = this.getRouteList().getRouteDescription(details.route.id)
            if (route?.originalName) {
                details.route.name = route.originalName
                detailsChanged =true
            }
        }

        return {detailsChanged}

    }
}