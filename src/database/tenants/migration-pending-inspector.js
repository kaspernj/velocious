// @ts-check

import MigrationsLedger from "../migrations-ledger.js"
import TenantIterator from "../../tenants/tenant-iterator.js"
import restArgsError from "../../utils/rest-args-error.js"

export default class TenantMigrationPendingInspector {
  /**
   * Runs constructor.
   * @param {object} args - Options object.
   * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
   * @param {string} args.identifier - Tenant database identifier.
   * @param {number[]} args.migrationVersions - Applicable migration versions.
   * @param {Array<ReturnType<typeof JSON.parse>>} args.tenants - Existing tenant descriptors.
   */
  constructor({configuration, identifier, migrationVersions, tenants, ...restArgs}) {
    restArgsError(restArgs)

    this.configuration = configuration
    this.identifier = identifier
    this.migrationVersions = migrationVersions.map((version) => `${version}`)
    this.tenants = tenants
  }

  /**
   * Reads every existing tenant ledger and reports aggregate pending state.
   * @returns {Promise<{hasPendingMigrations: boolean, identifier: string, migrationCount: number, pendingTenantCount: number, tenantCount: number}>} - Deploy preflight result.
   */
  async inspect() {
    let pendingTenantCount = 0

    for (const tenant of this.tenants) {
      if (await this.tenantHasPendingMigrations(tenant)) pendingTenantCount++
    }

    return {
      hasPendingMigrations: pendingTenantCount > 0,
      identifier: this.identifier,
      migrationCount: this.migrationVersions.length,
      pendingTenantCount,
      tenantCount: this.tenants.length
    }
  }

  /**
   * Reads one tenant's existing migration ledger without preparing or changing it.
   * @param {ReturnType<typeof JSON.parse>} tenant - Tenant descriptor.
   * @returns {Promise<boolean>} - Whether the tenant has an applicable pending migration.
   */
  async tenantHasPendingMigrations(tenant) {
    try {
      return await this.configuration.runWithTenant(tenant, async () => {
        return await this.configuration.ensureConnections({
          databaseIdentifiers: [this.identifier],
          name: `Tenant migration pending preflight: ${this.identifier}`
        }, async (dbs) => {
          const db = dbs[this.identifier]

          if (!db) throw new Error(`Tenant database identifier ${this.identifier} did not open a connection`)
          if (!await MigrationsLedger.tableExists(db)) throw new Error(`${MigrationsLedger.tableName()} ledger does not exist`)

          const appliedVersions = new Set(await MigrationsLedger.appliedVersions(db))

          return this.migrationVersions.some((version) => !appliedVersions.has(version))
        })
      })
    } catch (error) {
      const tenantLabel = TenantIterator.tenantLabel(tenant)

      throw new Error(`Could not read ${MigrationsLedger.tableName()} for tenant ${tenantLabel}`, {cause: error})
    }
  }
}
