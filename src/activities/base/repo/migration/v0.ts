import { ActivityInfo } from "../../model";
import { getActivityTotalElevation } from "../../utils";
import { ActivitiesDBMigrator, MigrationResult } from "./types";

export class MigrationV0 extends ActivitiesDBMigrator{
    migrate(activity: ActivityInfo): MigrationResult {        
        const {summary,details} = activity

        details.logs.forEach( log => {
            log.lng = log.lon
            delete log.lon
        })
        details.name = summary.name

        details.totalElevation = summary.totalElevation = getActivityTotalElevation(details)
        return {summaryChanged: true}

    }
}