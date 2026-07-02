// @ts-check

import BaseCommand from "../../../base-command.js"
import TenantDatabaseCommandHelper from "../../../tenant-database-command-helper.js"

export default class DbTenantsDrop extends BaseCommand {
  /**
   * Drops the tenant database/schema for every listed tenant through the provider's
   * `dropDatabase` hook.
   * @returns {Promise<{identifier: string, tenantCount: number} | void>} - Result in test mode.
   */
  async execute() {
    const helper = new TenantDatabaseCommandHelper({
      command: this,
      identifier: this.processArgs?.[1]
    })
    const provider = helper.provider

    if (typeof provider.dropDatabase !== "function") {
      throw new Error(`Tenant database provider for ${helper.identifier} must define dropDatabase to use db:tenants:drop`)
    }

    const tenantCount = await helper.eachTenant(async ({databaseConfiguration, tenant}) => {
      await provider.dropDatabase?.({
        configuration: this.getConfiguration(),
        databaseConfiguration,
        identifier: helper.identifier,
        tenant
      })
    })

    if (this.args.testing) return {identifier: helper.identifier, tenantCount}
  }
}
