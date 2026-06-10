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

  /** @returns {Promise<Array<?>>} - Tenants. */
  async listTenants() {
    this.validateTenantDatabaseIdentifier()
    await this.initializeRuntime()

    const tenants = await this.configuration.ensureConnections({name: `Tenant database list: ${this.identifier}`}, async () => {
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
   * @param {function({databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType, tenant: ?}) : Promise<void>} callback - Callback.
   * @returns {Promise<number>} - Number of tenants processed.
   */
  async eachTenant(callback) {
    const tenants = await this.listTenants()
    const parallelCount = this.parallelCount()

    if (parallelCount <= 1) {
      for (const tenant of tenants) {
        await this.runTenantCallback({callback, tenant})
      }

      return tenants.length
    }

    /** @type {Array<{error: Error, tenant: ?}>} */
    const failures = []
    const workers = []
    let tenantIndex = 0
    const workerCount = Math.min(parallelCount, tenants.length)

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
      const failedTenantLabels = failures.map((failure) => this.tenantLabel(failure.tenant)).join(", ")

      throw new AggregateError(
        failures.map((failure) => failure.error),
        `Failed tenant database command for tenant(s): ${failedTenantLabels}`
      )
    }

    return tenants.length
  }

  /** @returns {number} - Number of tenants to process concurrently. */
  parallelCount() {
    const parsedProcessArgs = this.command.args?.parsedProcessArgs || {}
    let parallelArg = parsedProcessArgs.parallel

    if (parallelArg === undefined) {
      const parallelArgIndex = this.command.processArgs?.indexOf("--parallel") ?? -1

      if (parallelArgIndex >= 0) {
        const nextArg = this.command.processArgs?.[parallelArgIndex + 1]

        parallelArg = nextArg && !nextArg.startsWith("-") ? nextArg : true
      }
    }

    if (parallelArg === undefined || parallelArg === false) return 1
    if (parallelArg === true) return 20

    const parallelCount = Number(parallelArg)

    if (!Number.isInteger(parallelCount) || parallelCount < 1) {
      throw new Error(`--parallel must be a positive integer when a value is provided: ${parallelArg}`)
    }

    return parallelCount
  }

  /**
   * @param {object} args - Tenant callback args.
   * @param {function({databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType, tenant: ?}) : Promise<void>} args.callback - Callback.
   * @param {?} args.tenant - Tenant.
   * @returns {Promise<void>}
   */
  async runTenantCallback({callback, tenant}) {
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

  /**
   * @param {?} tenant - Tenant.
   * @returns {string} - Human readable tenant label.
   */
  tenantLabel(tenant) {
    if (tenant && typeof tenant === "object") {
      const tenantObject = /** @type {{id?: ?, name?: ?, slug?: ?}} */ (tenant)

      if (tenantObject.slug) return String(tenantObject.slug)
      if (tenantObject.name) return String(tenantObject.name)
      if (tenantObject.id) return String(tenantObject.id)
    }

    return JSON.stringify(tenant)
  }
}
