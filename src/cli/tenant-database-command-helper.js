// @ts-check

import TenantIterator from "../tenants/tenant-iterator.js"

export default class TenantDatabaseCommandHelper {
  /**
   * Runs constructor.
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

  /**
   * Runs validate tenant database identifier.
   * @returns {void} */
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

  /**
   * Runs initialize runtime.
   * @returns {Promise<void>} - Resolves when app runtime is initialized.
   */
  async initializeRuntime() {
    await this.configuration.initialize({type: "db-tenants"})
  }

  /**
   * Runs list tenants.
   * @returns {Promise<Array<?>>} - Tenants.
   */
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
   * Runs each tenant.
   * @param {function({databaseConfiguration: import("../configuration-types.js").DatabaseConfigurationType, tenant: ?}) : Promise<void>} callback - Callback.
   * @returns {Promise<number>} - Number of tenants processed.
   */
  async eachTenant(callback) {
    const tenants = await this.listTenants()
    const iterator = new TenantIterator({
      configuration: this.configuration,
      identifier: this.identifier,
      parallelCount: this.parallelCount()
    })

    return await iterator.run(tenants, callback)
  }

  /**
   * Runs parallel count.
   * @returns {number} - Number of tenants to process concurrently.
   */
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
}
