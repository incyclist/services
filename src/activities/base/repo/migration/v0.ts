import { ActivityInfo } from "../../model";
import { getTotalElevation } from "../../utils";
import { ActivitiesDBMigrator, MigrationResult } from "./types";

export class MigrationV0 extends ActivitiesDBMigrator{
    migrate(activity: ActivityInfo): MigrationResult {        
        const {summary,details} = activity

        details.logs.forEach( log => {
            log.lng = log.lon
            delete log.lon
        })
        details.name = summary.name

        details.totalElevation = summary.totalElevation = getTotalElevation(details)
        return {summaryChanged: true}

    }
}