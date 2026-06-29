// @ts-check

/**
 * Runs a callback once within each tenant's context for a tenant database identifier,
 * optionally several tenants at a time. Each tenant is entered with `runWithTenant`, and a
 * tenant whose database identifier is inactive throws rather than running the callback
 * against the wrong connection. When iterating in parallel the per-tenant failures are
 * collected and rethrown together as an `AggregateError` so one bad tenant does not hide the
 * others. This is the iteration engine shared by the `db:tenants:*` CLI commands and the
 * runtime {@link Tenant} façade; the caller is responsible for producing the tenant list.
 */
export default class TenantIterator {
  /**
   * Creates an iterator bound to a configuration and tenant database identifier.
   * @param {{configuration: import("../configuration.js").default, identifier: string, parallelCount?: number}} args
   */
  constructor({configuration, identifier, parallelCount = 1}) {
    this.configuration = configuration
    this.identifier = identifier
    this.parallelCount = parallelCount
  }

  /**
   * Runs `callback` within each tenant's context and returns how many tenants were processed.
   * @param {Array<?>} tenants
   * @param {function({databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType, tenant: ?}) : Promise<void>} callback
   * @returns {Promise<number>}
   */
  async run(tenants, callback) {
    if (this.parallelCount <= 1) {
      for (const tenant of tenants) {
        await this.runTenantCallback({callback, tenant})
      }

      return tenants.length
    }

    /** @type {Array<{error: Error, tenant: ?}>} */
    const failures = []
    const workers = []
    let tenantIndex = 0
    const workerCount = Math.min(this.parallelCount, tenants.length)

    for (let workerIndex = 0; workerIndex < workerCount; workerIndex++) {
      workers.push((async () => {
        while (tenantIndex < tenants.length) {
          const tenant = tenants[tenantIndex]

          tenantIndex++

          try {
            await this.runTenantCallback({callback, tenant})
          } catch (error) {
            failures.push({
              error: error instanceof Error ? error : new Error(String(error)),
              tenant
            })
          }
        }
      })())
    }

    await Promise.all(workers)

    if (failures.length > 0) {
      const failedTenantLabels = failures.map((failure) => TenantIterator.tenantLabel(failure.tenant)).join(", ")

      throw new AggregateError(
        failures.map((failure) => failure.error),
        `Failed tenant database command for tenant(s): ${failedTenantLabels}`
      )
    }

    return tenants.length
  }

  /**
   * Enters one tenant's context and runs the callback, asserting the database is active first.
   * @param {{callback: function({databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType, tenant: ?}) : Promise<void>, tenant: ?}} args
   * @returns {Promise<void>}
   */
  async runTenantCallback({callback, tenant}) {
    await this.configuration.runWithTenant(tenant, async () => {
      if (!this.configuration.isDatabaseIdentifierActive(this.identifier)) {
        throw new Error(`Tenant database identifier ${this.identifier} is inactive for tenant: ${TenantIterator.tenantLabel(tenant)}`)
      }

      await callback({
        databaseConfiguration: this.configuration.resolveDatabaseConfiguration(this.identifier),
        tenant
      })
    })
  }

  /**
   * Builds a human-readable label for a tenant for use in error messages.
   * @param {?} tenant
   * @returns {string}
   */
  static tenantLabel(tenant) {
    if (tenant && typeof tenant === "object") {
      const tenantObject = /** @type {{id?: ?, name?: ?, slug?: ?}} */ (tenant)

      if (tenantObject.slug) return String(tenantObject.slug)
      if (tenantObject.name) return String(tenantObject.name)
      if (tenantObject.id) return String(tenantObject.id)
    }

    return JSON.stringify(tenant)
  }
}
