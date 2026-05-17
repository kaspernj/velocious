// @ts-check

import BaseCommand from "../../../base-command.js"
import TenantDatabaseCommandHelper from "../../../tenant-database-command-helper.js"

export default class DbTenantsCheck extends BaseCommand {
  /** @returns {Promise<{identifier: string, tenantCount: number} | void>} - Result in test mode. */
  async execute() {
    const helper = new TenantDatabaseCommandHelper({
      command: this,
      identifier: this.processArgs?.[1]
    })
    const provider = helper.provider
    const tenantCount = await helper.eachTenant(async ({databaseConfiguration, tenant}) => {
      if (typeof provider.checkTenant === "function") {
        await provider.checkTenant({
          configuration: this.getConfiguration(),
          databaseConfiguration,
          identifier: helper.identifier,
          tenant
        })
      }

      await this.getConfiguration().ensureConnections(async (dbs) => {
        const db = dbs[helper.identifier]

        if (!db) throw new Error(`Tenant database identifier ${helper.identifier} did not open a connection`)

        await db.query("SELECT 1")
      })
    })

    if (this.args.testing) return {identifier: helper.identifier, tenantCount}
  }
}
