// @ts-check

import Current from "../current.js"
import TenantIterator from "./tenant-iterator.js"

/**
 * Apartment-style runtime façade for multi-tenant apps. A "tenant" is whatever descriptor
 * object the app's `tenantDatabaseResolver` understands (an account, a project, …); this
 * class is the single discoverable home for switching into a tenant's context, reading the
 * current one, iterating every tenant of a database identifier, and dropping a tenant's
 * database. Switching/reading delegate to {@link Current} (which owns the async-context
 * tenant state), so they compose with the existing connection pools and request lifecycle;
 * iteration and drop drive the app's tenant database provider hooks.
 */
export default class Tenant {
  /**
   * Runs `callback` with `tenant` as the current tenant, restoring the previous tenant after.
   * @param {object} tenant Descriptor understood by the app's tenantDatabaseResolver.
   * @param {() => Promise<?>} callback
   * @returns {Promise<?>}
   */
  static async with(tenant, callback) {
    return await Current.withTenant(tenant, callback)
  }

  /**
   * The current tenant descriptor, or undefined when running outside any tenant context.
   * @returns {Record<string, unknown> | undefined}
   */
  static current() {
    return Current.tenant()
  }

  /**
   * Lists the tenants for a database identifier through the provider and runs `callback`
   * within each tenant's context, optionally filtered and several at a time. Returns how
   * many tenants the callback ran for (after filtering).
   * @param {{identifier: string, callback: function({databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType, tenant: ?}) : Promise<void>, parallel?: number, filter?: (tenant: ?) => boolean, configuration?: import("../configuration.js").default}} args
   * @returns {Promise<number>}
   */
  static async each({identifier, callback, parallel = 1, filter, configuration = Current.configuration()}) {
    const provider = configuration.getTenantDatabaseProvider(identifier)
    const listedTenants = await configuration.ensureConnections({name: `Tenant.each: ${identifier}`}, async () => {
      return await provider.listTenants({configuration, identifier})
    })

    if (!Array.isArray(listedTenants)) {
      throw new Error(`Tenant database provider for ${identifier} must return an array from listTenants`)
    }

    const tenants = filter ? listedTenants.filter(filter) : listedTenants
    const iterator = new TenantIterator({configuration, identifier, parallelCount: parallel})

    return await iterator.run(tenants, callback)
  }

  /**
   * Drops one tenant's database/schema through the provider's `dropDatabase` hook.
   * @param {{identifier: string, tenant: object, configuration?: import("../configuration.js").default}} args
   * @returns {Promise<void>}
   */
  static async drop({identifier, tenant, configuration = Current.configuration()}) {
    const provider = configuration.getTenantDatabaseProvider(identifier)

    if (typeof provider.dropDatabase !== "function") {
      throw new Error(`Tenant database provider for ${identifier} must define dropDatabase to drop a tenant`)
    }

    await configuration.runWithTenant(tenant, async () => {
      await provider.dropDatabase?.({
        configuration,
        databaseConfiguration: configuration.resolveDatabaseConfiguration(identifier),
        identifier,
        tenant
      })
    })
  }
}
