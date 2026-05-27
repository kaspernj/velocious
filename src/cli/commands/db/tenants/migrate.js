// @ts-check

import {digg} from "diggerize"
import BaseCommand from "../../../base-command.js"
import Migrator from "../../../../database/migrator.js"
import TenantDatabaseCommandHelper from "../../../tenant-database-command-helper.js"

export default class DbTenantsMigrate extends BaseCommand {
  /** @returns {Promise<{identifier: string, migrationCount: number, tenantCount: number} | void>} - Result in test mode. */
  async execute() {
    const helper = new TenantDatabaseCommandHelper({
      command: this,
      identifier: this.processArgs?.[1]
    })
    const migrations = await this.getEnvironmentHandler().findMigrations()
    const tenantCount = await helper.eachTenant(async ({databaseConfiguration, tenant}) => {
      const migrator = new Migrator({
        configuration: this.getConfiguration(),
        databaseIdentifiers: [helper.identifier]
      })

      await this.getConfiguration().ensureConnections(async () => {
        await migrator.prepare()
        await migrator.migrateFiles(migrations, digg(this.getEnvironmentHandler(), "requireMigration"))
      })

      if (typeof helper.provider.afterMigrateTenant === "function") {
        await helper.provider.afterMigrateTenant({
          configuration: this.getConfiguration(),
          databaseConfiguration,
          identifier: helper.identifier,
          tenant
        })
      }
    })

    if (this.args.testing) {
      return {
        identifier: helper.identifier,
        migrationCount: migrations.length,
        tenantCount
      }
    }
  }
}
