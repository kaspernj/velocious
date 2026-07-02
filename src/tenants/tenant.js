// @ts-check

import Current from "../current.js"
import TenantIterator from "./tenant-iterator.js"

/**
 * Apartment-style runtime façade for multi-tenant apps. A "tenant" is whatever descriptor
 * object the app's `tenantDatabaseResolver` understands (an account, a project, …); this
 * class is the single discoverable home for switching into a tenant's context, reading the
 * current one, iterating every tenant of a database identifier, and dropping a tenant's
 * database. Switching delegates to {@link Current} (which owns the async-context tenant
 * state) and additionally runs the callback inside `ensureConnections`, so entering a tenant
 * makes its database immediately queryable — the apartment-style "switch" semantics — without
 * the caller establishing connections itself; iteration and drop drive the app's tenant
 * database provider hooks.
 */
export default class Tenant {
  /**
   * Runs `callback` with `tenant` as the current tenant, restoring the previous tenant after.
   * The callback runs inside `ensureConnections`, so every database identifier the tenant
   * activates (the global database plus the tenant's database) has a checked-out connection
   * available for the callback's duration: switching into a tenant makes it queryable without
   * the caller wiring up connections. Already-checked-out connections are reused, so nesting
   * `Tenant.with` calls does not open redundant connections. The callback receives the active
   * connections keyed by identifier, the same as `ensureConnections`.
   * @template T
   * @param {object} tenant Descriptor understood by the app's tenantDatabaseResolver.
   * @param {(connections: Record<string, import("../database/drivers/base.js").default>) => Promise<T>} callback
   * @returns {Promise<T>}
   */
  static async with(tenant, callback) {
    const configuration = Current.configuration()

    return await Current.withTenant(tenant, async () => await configuration.ensureConnections(callback))
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
   * within each tenant's context, optionally filtered and several at a time. Like
   * {@link Tenant.with}, the callback runs inside `ensureConnections` so each tenant's
   * database is queryable without the caller wiring up connections. Returns how many tenants
   * the callback ran for (after filtering).
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

    // Run each tenant's callback inside ensureConnections so the iterator stays
    // connection-agnostic (the db:tenants:* CLI commands share TenantIterator and must run
    // their callbacks, such as create, before the tenant database exists) while runtime
    // iteration here gets the tenant's connections established the same way Tenant.with does.
    return await iterator.run(tenants, async (callbackArgs) => {
      await configuration.ensureConnections({name: `Tenant.each: ${identifier}`}, async () => await callback(callbackArgs))
    })
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
      // Guard against an unresolved tenant. resolveDatabaseConfiguration falls back to the
      // base (template/default) tenant database when the resolver returns nothing for this
      // descriptor, so without this check a provider that drops by databaseConfiguration.name
      // would drop the template database instead of rejecting the bad tenant.
      if (!configuration.isDatabaseIdentifierActive(identifier)) {
        throw new Error(`Tenant database identifier ${identifier} is inactive for tenant: ${TenantIterator.tenantLabel(tenant)}`)
      }

      await provider.dropDatabase?.({
        configuration,
        databaseConfiguration: configuration.resolveDatabaseConfiguration(identifier),
        identifier,
        tenant
      })
    })
  }
}
