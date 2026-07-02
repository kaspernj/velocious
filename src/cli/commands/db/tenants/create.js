// @ts-check

import BaseCommand from "../../../base-command.js"
import {createTenantDatabase} from "../../../../tenants/default-tenant-database-provisioning.js"
import TenantDatabaseCommandHelper from "../../../tenant-database-command-helper.js"

export default class DbTenantsCreate extends BaseCommand {
  /**
   * Runs execute.
   * @returns {Promise<{identifier: string, tenantCount: number} | void>} - Result in test mode.
   */
  async execute() {
    const helper = new TenantDatabaseCommandHelper({
      command: this,
      identifier: this.processArgs?.[1]
    })
    const provider = helper.provider
    // Providers may customize creation, but the generic driver-agnostic provisioning
    // is the framework default so apps do not reimplement it.
    const createDatabase = typeof provider.createDatabase === "function"
      ? provider.createDatabase.bind(provider)
      : createTenantDatabase

    const tenantCount = await helper.eachTenant(async ({databaseConfiguration, tenant}) => {
      await createDatabase({
        configuration: this.getConfiguration(),
        databaseConfiguration,
        identifier: helper.identifier,
        tenant
      })
    })

    if (this.args.testing) return {identifier: helper.identifier, tenantCount}
  }
}
