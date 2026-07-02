// @ts-check

import BaseCommand from "../../../base-command.js"
import {dropTenantDatabase} from "../../../../tenants/default-tenant-database-provisioning.js"
import TenantDatabaseCommandHelper from "../../../tenant-database-command-helper.js"

export default class DbTenantsDrop extends BaseCommand {
  /**
   * Drops the tenant database/schema for every listed tenant through the provider's
   * `dropDatabase` hook, or the framework default when the provider defines none.
   * @returns {Promise<{identifier: string, tenantCount: number} | void>} - Result in test mode.
   */
  async execute() {
    const helper = new TenantDatabaseCommandHelper({
      command: this,
      identifier: this.processArgs?.[1]
    })
    const provider = helper.provider
    const dropDatabase = typeof provider.dropDatabase === "function"
      ? provider.dropDatabase.bind(provider)
      : dropTenantDatabase

    const tenantCount = await helper.eachTenant(async ({databaseConfiguration, tenant}) => {
      await dropDatabase({
        configuration: this.getConfiguration(),
        databaseConfiguration,
        identifier: helper.identifier,
        tenant
      })
    })

    if (this.args.testing) return {identifier: helper.identifier, tenantCount}
  }
}
