import { ActivityInfo } from "../../model";
import { getTotalElevation } from "../../utils";
import { ActivitiesDBMigrator, MigrationResult } from "./types";

export class MigrationV2 extends ActivitiesDBMigrator{
    migrate(activity: ActivityInfo): MigrationResult {
        activity.details.startTime = new Date(activity.details.startTime).toISOString()
        return {detailsChanged: true}
    }
}