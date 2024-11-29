import { RouteListService, useRouteList } from "../../../../routes";
import { ActivityInfo } from "../../model";

export type MigrationResult = {
    summaryChanged?: boolean
    detailsChanged?: boolean
}
export interface IActivityDBMigrator {
    migrate(activity: ActivityInfo): MigrationResult
}

export class ActivitiesDBMigrator implements IActivityDBMigrator {

    constructor(protected injected:Record<string,any>={}) {}

    migrate(activity: ActivityInfo): MigrationResult {
        throw new Error("Method not implemented.");
    }

    getRouteList():RouteListService {
        return this.injected['routeList']??useRouteList()
    }
}