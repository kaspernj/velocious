// @ts-check

import {digg} from "diggerize"
import BaseCommand from "../../../../base-command.js"
import TenantDatabaseCommandHelper from "../../../../tenant-database-command-helper.js"
import TenantMigrationPendingInspector from "../../../../../database/tenants/migration-pending-inspector.js"

export default class DbTenantsMigrationsPending extends BaseCommand {
  /**
   * Reports aggregate tenant migration state as one machine-readable JSON object.
   * @returns {Promise<{hasPendingMigrations: boolean, identifier: string, migrationCount: number, pendingTenantCount: number, tenantCount: number}>} - Deploy preflight result.
   */
  async execute() {
    const helper = new TenantDatabaseCommandHelper({
      command: this,
      identifier: this.processArgs?.[1]
    })
    const migrations = await this.getEnvironmentHandler().findMigrations()
    const requireMigration = digg(this.getEnvironmentHandler(), "requireMigration")
    const applicableMigrationVersions = []

    for (const migration of migrations) {
      if (!migration.fullPath) throw new Error(`Migration didn't have a fullPath key: ${migration.file}`)

      const MigrationClass = await requireMigration(migration.fullPath)

      if ((MigrationClass.getDatabaseIdentifiers() || ["default"]).includes(helper.identifier)) {
        applicableMigrationVersions.push(migration.date)
      }
    }

    const tenants = await helper.listTenants()
    const inspector = new TenantMigrationPendingInspector({
      configuration: this.getConfiguration(),
      identifier: helper.identifier,
      migrationVersions: applicableMigrationVersions,
      tenants
    })
    const result = await inspector.inspect()

    if (!this.args.testing) console.log(JSON.stringify(result))

    return result
  }
}
