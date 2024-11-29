import { ActivitiesDBMigrator, IActivityDBMigrator } from "./types"
import { MigrationV0 } from "./v0"
import { MigrationV1 } from "./v1"
import { MigrationV2 } from "./v2"
import { MigrationV3 } from "./v3"

export class ActivitiesDBMigratorFactory {

    static readonly migrators: Array< typeof ActivitiesDBMigrator > = [
        MigrationV0,
        MigrationV1,
        MigrationV2,
        MigrationV3
    ]

    static readonly injected:Record<string,any> ={}

    static inject(string, value) {
        this.injected[string] = value
    }

    static create( version:number ):IActivityDBMigrator {
        const Migrator = this.migrators[version]
        if (Migrator)
            return new Migrator(this.injected)
    }
}