// @ts-check

import {digg} from "diggerize"
import BaseCommand from "../../../base-command.js"
import Migrator from "../../../../database/migrator.js"
import TenantDatabaseCommandHelper from "../../../tenant-database-command-helper.js"

export default class DbTenantsMigrate extends BaseCommand {
  /**
   * Runs execute.
   * @returns {Promise<{identifier: string, migrationCount: number, tenantCount: number} | void>} - Result in test mode.
   */
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

      let migrationsApplied = 0

      await this.getConfiguration().ensureConnections({databaseIdentifiers: [helper.identifier], name: `DB tenants migrate: ${helper.identifier}`}, async () => {
        await migrator.prepare()
        migrationsApplied = await migrator.migrateFiles(migrations, digg(this.getEnvironmentHandler(), "requireMigration"))
      })

      const afterMigrateTenant = helper.provider.afterMigrateTenant

      if (typeof afterMigrateTenant === "function") {
        await this.getConfiguration().ensureConnections({name: `DB tenants after migrate: ${helper.identifier}`}, async () => {
          await afterMigrateTenant({
            configuration: this.getConfiguration(),
            databaseConfiguration,
            identifier: helper.identifier,
            migrationsApplied,
            tenant
          })
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
