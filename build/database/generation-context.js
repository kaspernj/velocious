// @ts-check

import Tenant from "../tenants/tenant.js"

/**
 * Immutable selection of one logical tenant database and one provider-resolved
 * physical tenant. Schema tools can share this contract without ambient or
 * process-global selection state.
 */
export default class DatabaseGenerationContext {
  /**
   * Resolves one tenant-only database from its provider and captures its physical identity.
   * @param {object} args - Selection arguments.
   * @param {import("../configuration.js").default} args.configuration - Owning configuration.
   * @param {string} args.databaseIdentifier - Logical tenant-only database identifier.
   * @returns {Promise<DatabaseGenerationContext>} - Immutable selected database context.
   */
  static async resolve({configuration, databaseIdentifier}) {
    const databaseConfiguration = configuration.getDatabaseConfiguration()[databaseIdentifier]

    if (!databaseConfiguration) {
      throw new Error(`No such tenant database identifier configured: ${databaseIdentifier}`)
    }
    if (!databaseConfiguration.tenantOnly) {
      throw new Error(`Database identifier ${databaseIdentifier} is not configured with tenantOnly: true`)
    }
    if (configuration.getDisabledDatabaseIdentifiers().has(databaseIdentifier)) {
      throw new Error(`Tenant database identifier ${databaseIdentifier} is disabled by VELOCIOUS_DISABLED_DATABASE_IDENTIFIERS`)
    }

    const provider = configuration.getTenantDatabaseProvider(databaseIdentifier)

    await configuration.initialize({type: "database-generation"})

    const tenants = await configuration.ensureConnections({name: `Resolve database generation context: ${databaseIdentifier}`}, async () => {
      if (provider.resolveGenerationTenant) {
        const tenant = await provider.resolveGenerationTenant({configuration, identifier: databaseIdentifier})

        return tenant === undefined ? [] : [tenant]
      }

      return await provider.listTenants({configuration, identifier: databaseIdentifier})
    })

    if (!Array.isArray(tenants)) {
      throw new Error(`Tenant database provider for ${databaseIdentifier} must return an array from listTenants`)
    }
    if (tenants.length === 0) {
      throw new Error(`Tenant database selection ${databaseIdentifier} resolved no tenants`)
    }
    if (tenants.length !== 1) {
      throw new Error(`Tenant database selection ${databaseIdentifier} is ambiguous: provider returned ${tenants.length} tenants`)
    }

    const tenant = tenants[0]

    if (!tenant || typeof tenant !== "object" || Array.isArray(tenant)) {
      throw new Error(`Tenant database selection ${databaseIdentifier} returned an invalid tenant descriptor`)
    }

    const handle = Tenant.handle(tenant, configuration)

    // Resolve now so an inactive/stale descriptor fails before a selected
    // schema connection can be checked out or read.
    handle.databaseConfiguration(databaseIdentifier)

    return new DatabaseGenerationContext({configuration, databaseIdentifier, handle})
  }

  /**
   * Runs constructor.
   * @param {object} args - Captured selection.
   * @param {import("../configuration.js").default} args.configuration - Owning configuration.
   * @param {string} args.databaseIdentifier - Logical database identifier.
   * @param {ReturnType<typeof Tenant.handle>} args.handle - Captured tenant handle.
   */
  constructor({configuration, databaseIdentifier, handle}) {
    this._configuration = configuration
    this._databaseIdentifier = databaseIdentifier
    this._handle = handle

    Object.freeze(this)
  }

  /**
   * Returns the captured logical database identifier.
   * @returns {string} - Captured logical database identifier.
   */
  databaseIdentifier() { return this._databaseIdentifier }

  /**
   * Returns the captured physical database configuration.
   * @returns {import("../configuration-types.js").DatabaseConfigurationType} - Captured physical database configuration.
   */
  databaseConfiguration() { return this._handle.databaseConfiguration(this._databaseIdentifier) }

  /**
   * Returns the captured tenant descriptor.
   * @returns {ReturnType<ReturnType<typeof Tenant.handle>["tenant"]>} - Captured immutable tenant descriptor.
   */
  tenant() { return this._handle.tenant() }

  /**
   * Runs work on one connection pinned to the captured physical database.
   * @template T
   * @param {object} args - Work arguments.
   * @param {(connection: import("./drivers/base.js").default) => Promise<T>} args.callback - Selected database work.
   * @param {string} args.name - Checkout name.
   * @returns {Promise<T>} - Callback result.
   */
  async run({callback, name}) {
    return await this._configuration.runWithTenant(this.tenant(), async () => {
      return await this._configuration.withDatabaseOperation({
        databaseConfiguration: this.databaseConfiguration(),
        databaseIdentifier: this.databaseIdentifier(),
        name,
        tenant: this.tenant()
      }, async (operation) => await callback(operation.connection()))
    })
  }
}
