// @ts-check

import TenantIterator from "../tenants/tenant-iterator.js"

const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000

export default class TenantDatabaseCommandHelper {
  /**
   * Runs constructor.
   * @param {object} args - Options object.
   * @param {import("./base-command.js").default} args.command - CLI command instance.
   * @param {number} [args.heartbeatIntervalMs] - Interval between progress heartbeats.
   * @param {string | undefined} args.identifier - Tenant database identifier.
   * @param {(message: string) => void} [args.output] - Progress output handler.
   */
  constructor({command, heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS, identifier, output = console.log}) {
    if (!identifier) throw new Error("Missing tenant database identifier argument")

    this.command = command
    this.configuration = command.getConfiguration()
    this.heartbeatIntervalMs = heartbeatIntervalMs
    this.identifier = identifier
    this.output = output
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
    const commandName = this.command.processArgs?.[0] || "db:tenants"
    const parallelCount = this.parallelCount()
    const progressPrefix = `${commandName} ${this.identifier}`
    let activeTenantCount = 0
    let completedTenantCount = 0
    const iterator = new TenantIterator({
      configuration: this.configuration,
      identifier: this.identifier,
      parallelCount
    })
    const progressHeartbeat = setInterval(() => {
      this.output(`${progressPrefix}: heartbeat: ${completedTenantCount}/${tenants.length} completed, ${activeTenantCount} active`)
    }, this.heartbeatIntervalMs)

    progressHeartbeat.unref()
    this.output(`${progressPrefix}: processing ${tenants.length} tenant(s) with parallelism ${parallelCount}`)

    try {
      const processedTenantCount = await iterator.run(tenants, async (args) => {
        activeTenantCount++

        try {
          await callback(args)
          completedTenantCount++
          this.output(`${progressPrefix}: completed ${TenantIterator.tenantLabel(args.tenant)} (${completedTenantCount}/${tenants.length})`)
        } finally {
          activeTenantCount--
        }
      })

      this.output(`${progressPrefix}: finished ${processedTenantCount}/${tenants.length} tenant(s)`)

      return processedTenantCount
    } finally {
      clearInterval(progressHeartbeat)
    }
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
