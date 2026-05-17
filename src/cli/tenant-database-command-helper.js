// @ts-check

export default class TenantDatabaseCommandHelper {
  /**
   * @param {object} args - Options object.
   * @param {import("./base-command.js").default} args.command - CLI command instance.
   * @param {string | undefined} args.identifier - Tenant database identifier.
   */
  constructor({command, identifier}) {
    if (!identifier) throw new Error("Missing tenant database identifier argument")

    this.command = command
    this.configuration = command.getConfiguration()
    this.identifier = identifier
    this.provider = this.configuration.getTenantDatabaseProvider(identifier)
  }

  /** @returns {void} */
  validateTenantDatabaseIdentifier() {
    const databaseConfiguration = this.configuration.getDatabaseConfiguration()[this.identifier]

    if (!databaseConfiguration) {
      throw new Error(`No such database identifier configured: ${this.identifier}`)
    }

    if (!databaseConfiguration.tenantOnly) {
      throw new Error(`Database identifier ${this.identifier} is not configured with tenantOnly: true`)
    }

    if (this.configuration.getDisabledDatabaseIdentifiers().has(this.identifier)) {
      throw new Error(`Tenant database identifier ${this.identifier} is disabled by VELOCIOUS_DISABLED_DATABASE_IDENTIFIERS`)
    }

    if (typeof this.provider.listTenants !== "function") {
      throw new Error(`Tenant database provider for ${this.identifier} must define listTenants`)
    }
  }

  /** @returns {Promise<void>} - Resolves when app runtime is initialized. */
  async initializeRuntime() {
    await this.configuration.initialize({type: "db-tenants"})
  }

  /** @returns {Promise<unknown[]>} - Tenants. */
  async listTenants() {
    this.validateTenantDatabaseIdentifier()
    await this.initializeRuntime()

    const tenants = await this.configuration.ensureConnections(async () => {
      return await this.provider.listTenants({
        configuration: this.configuration,
        identifier: this.identifier
      })
    })

    if (!Array.isArray(tenants)) {
      throw new Error(`Tenant database provider for ${this.identifier} must return an array from listTenants`)
    }

    return tenants
  }

  /**
   * @param {function({databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType, tenant: unknown}) : Promise<void>} callback - Callback.
   * @returns {Promise<number>} - Number of tenants processed.
   */
  async eachTenant(callback) {
    const tenants = await this.listTenants()

    for (const tenant of tenants) {
      await this.configuration.runWithTenant(tenant, async () => {
        if (!this.configuration.isDatabaseIdentifierActive(this.identifier)) {
          throw new Error(`Tenant database identifier ${this.identifier} is inactive for tenant: ${this.tenantLabel(tenant)}`)
        }

        await callback({
          databaseConfiguration: this.configuration.resolveDatabaseConfiguration(this.identifier),
          tenant
        })
      })
    }

    return tenants.length
  }

  /**
   * @param {unknown} tenant - Tenant.
   * @returns {string} - Human readable tenant label.
   */
  tenantLabel(tenant) {
    if (tenant && typeof tenant === "object") {
      const tenantObject = /** @type {{id?: unknown, name?: unknown, slug?: unknown}} */ (tenant)

      if (tenantObject.slug) return String(tenantObject.slug)
      if (tenantObject.name) return String(tenantObject.name)
      if (tenantObject.id) return String(tenantObject.id)
    }

    return JSON.stringify(tenant)
  }
}
