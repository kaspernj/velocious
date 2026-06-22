// @ts-check

import {validateTimeZone} from "../time-zone.js"

/**
 * CommandFileObjectType type.
 * @typedef {object} CommandFileObjectType
 * @property {string} name - Command name.
 * @property {string} file - Command file path.
 */

/**
 * MigrationObjectType type.
 * @typedef {object} MigrationObjectType
 * @property {number} date - Migration timestamp parsed from filename.
 * @property {string} [fullPath] - Absolute path to the migration file.
 * @property {string} migrationClassName - Exported migration class name.
 * @property {string} file - Migration filename.
 */

export default class VelociousEnvironmentHandlerBase {
  /**
   * Runs debug endpoint token matches.
   * @param {string} providedToken - Token from the request.
   * @param {string} expectedToken - Configured token.
   * @returns {boolean} - Whether both tokens match.
   */
  debugEndpointTokenMatches(providedToken, expectedToken) {
    let difference = providedToken.length ^ expectedToken.length
    const maxLength = Math.max(providedToken.length, expectedToken.length)

    for (let index = 0; index < maxLength; index++) {
      difference |= (providedToken.charCodeAt(index) || 0) ^ (expectedToken.charCodeAt(index) || 0)
    }

    return difference === 0
  }

  /**
   * Runs get framework source directory.
   * @returns {string | undefined} - Velocious source directory used to filter framework stack frames.
   */
  getFrameworkSourceDirectory() {
    return undefined
  }

  /**
   * Auto-discovers resource classes. No-op in base handler; overridden in Node handler.
   * @param {import("../configuration.js").default} _configuration - Configuration instance.
   * @returns {Promise<void>}
   */
  async autoDiscoverResources(_configuration) {}

  /**
   * Runs run with timezone offset.
   * @param {number} _offsetMinutes - Offset in minutes (Date#getTimezoneOffset).
   * @param {() => Promise<?>} callback - Callback to run.
   * @returns {Promise<?>} - Result of the callback.
   */
  async runWithTimezoneOffset(_offsetMinutes, callback) {
    if (!this.configuration) throw new Error("Configuration hasn't been set")

    const previousOffsetMinutes = this.configuration._timezoneOffsetMinutes

    this.configuration._timezoneOffsetMinutes = _offsetMinutes

    try {
      return await callback()
    } finally {
      this.configuration._timezoneOffsetMinutes = previousOffsetMinutes
    }
  }

  /**
   * Runs run with timezone.
   * @param {string} timeZone - IANA timezone identifier.
   * @param {() => Promise<?>} callback - Callback to run.
   * @returns {Promise<?>} - Result of the callback.
   */
  async runWithTimezone(timeZone, callback) {
    if (!this.configuration) throw new Error("Configuration hasn't been set")

    const previousTimeZone = this.configuration._timeZone

    this.configuration._timeZone = validateTimeZone(timeZone, "timeZone")

    try {
      return await callback()
    } finally {
      this.configuration._timeZone = previousTimeZone
    }
  }

  /**
   * Runs set timezone offset.
   * @param {number} _offsetMinutes - Offset in minutes (Date#getTimezoneOffset).
   * @returns {void} - No return value.
   */
  setTimezoneOffset(_offsetMinutes) {
    if (!this.configuration) throw new Error("Configuration hasn't been set")

    /**
     * Narrows the runtime value to the documented type.
     * @type {number} */
    this.configuration._timezoneOffsetMinutes = _offsetMinutes
  }

  /**
   * Runs set timezone.
   * @param {string} timeZone - IANA timezone identifier.
   * @returns {void} - No return value.
   */
  setTimezone(timeZone) {
    if (!this.configuration) throw new Error("Configuration hasn't been set")

    this.configuration._timeZone = validateTimeZone(timeZone, "timeZone")
  }

  /**
   * Runs get timezone offset minutes.
   * @param {import("../configuration.js").default | undefined} configuration - Configuration instance.
   * @returns {number} - Offset in minutes.
   */
  getTimezoneOffsetMinutes(configuration) {
    const activeConfiguration = configuration || this.configuration

    if (!activeConfiguration) throw new Error("Configuration hasn't been set")

    if (typeof activeConfiguration._timezoneOffsetMinutes === "number") {
      return activeConfiguration._timezoneOffsetMinutes
    }

    return /** @type {number} */ (activeConfiguration.getTimezoneOffsetMinutes())
  }

  /**
   * Runs get timezone.
   * @param {import("../configuration.js").default | undefined} configuration - Configuration instance.
   * @returns {string | undefined} - Timezone identifier.
   */
  getTimeZone(configuration) {
    const activeConfiguration = configuration || this.configuration

    if (!activeConfiguration) throw new Error("Configuration hasn't been set")

    return activeConfiguration.getTimeZone()
  }

  /**
   * Runs run with request timing.
   * @param {import("../http-server/client/request-timing.js").default | undefined} requestTiming - Request timing collector.
   * @param {() => Promise<?>} callback - Callback.
   * @returns {Promise<?>} - Callback result.
   */
  async runWithRequestTiming(requestTiming, callback) {
    this._currentRequestTiming = requestTiming

    try {
      return await callback()
    } finally {
      this._currentRequestTiming = undefined
    }
  }

  /**
   * Runs get current request timing.
   * @returns {import("../http-server/client/request-timing.js").default | undefined} - Current request timing collector.
   */
  getCurrentRequestTiming() {
    return this._currentRequestTiming
  }

  /**
   * Runs run with ability.
   * @param {import("../authorization/ability.js").default | undefined} ability - Ability to set for callback scope.
   * @param {() => Promise<?>} callback - Callback.
   * @returns {Promise<?>} - Callback result.
   */
  async runWithAbility(ability, callback) {
    this._currentAbility = ability

    try {
      return await callback()
    } finally {
      this._currentAbility = undefined
    }
  }

  /**
   * Runs set current ability.
   * @param {import("../authorization/ability.js").default | undefined} ability - Ability to set.
   * @returns {void} - No return value.
   */
  setCurrentAbility(ability) {
    this._currentAbility = ability
  }

  /**
   * Runs get current ability.
   * @returns {import("../authorization/ability.js").default | undefined} - Current ability.
   */
  getCurrentAbility() {
    return this._currentAbility
  }

  /**
   * Runs run with tenant.
   * @param {?} tenant - Tenant to set for callback scope.
   * @param {() => Promise<?>} callback - Callback.
   * @returns {Promise<?>} - Callback result.
   */
  async runWithTenant(tenant, callback) {
    this._currentTenant = tenant

    try {
      return await callback()
    } finally {
      this._currentTenant = undefined
    }
  }

  /**
   * Runs set current tenant.
   * @param {?} tenant - Tenant to set.
   * @returns {void} - No return value.
   */
  setCurrentTenant(tenant) {
    this._currentTenant = tenant
  }

  /**
   * Runs get current tenant.
   * @returns {?} - Current tenant.
   */
  getCurrentTenant() {
    return this._currentTenant
  }
  /**
   * Runs cli commands generate base models.
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsGenerateBaseModels(_command) {
    throw new Error("cliCommandsGenerateBaseModels not implemented")
  }

  /**
   * Runs cli commands generate frontend models.
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsGenerateFrontendModels(_command) {
    throw new Error("cliCommandsGenerateFrontendModels not implemented")
  }

  /**
   * Runs cli commands init.
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsInit(command) { // eslint-disable-line no-unused-vars
    throw new Error("cliCommandsInit not implemented")
  }

  /**
   * Runs cli commands migration generate.
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsMigrationGenerate(_command) {
    throw new Error("cliCommandsMigrationGenerate not implemented")
  }

  /**
   * Runs cli commands migration destroy.
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsMigrationDestroy(_command) {
    throw new Error("cliCommandsMigrationDestroy not implemented")
  }

  /**
   * Runs cli commands generate model.
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsGenerateModel(_command) {
    throw new Error("cliCommandsGenerateModel not implemented")
  }

  /**
   * Runs cli commands lint relationships.
   * @abstract
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsLintRelationships(_command) {
    throw new Error("cliCommandsLintRelationships not implemented")
  }

  /**
   * Runs cli commands routes.
   * @abstract
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsRoutes(_command) {
    throw new Error("cliCommandsRoutes not implemented")
  }

  /**
   * Runs cli commands console.
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsConsole(_command) {
    throw new Error("cliCommandsConsole not implemented")
  }

  /**
   * Runs cli commands server.
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsServer(_command) {
    throw new Error("cliCommandsServer not implemented")
  }

  /**
   * Runs cli commands test.
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsTest(_command) {
    throw new Error("cliCommandsTest not implemented")
  }

  /**
   * Runs cli commands background jobs main.
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsBackgroundJobsMain(_command) {
    throw new Error("cliCommandsBackgroundJobsMain not implemented")
  }

  /**
   * Runs cli commands background jobs worker.
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsBackgroundJobsWorker(_command) {
    throw new Error("cliCommandsBackgroundJobsWorker not implemented")
  }

  /**
   * Runs cli commands background jobs runner.
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsBackgroundJobsRunner(_command) {
    throw new Error("cliCommandsBackgroundJobsRunner not implemented")
  }

  /**
   * Runs cli commands beacon.
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsBeacon(_command) {
    throw new Error("cliCommandsBeacon not implemented")
  }

  /**
   * Loads the TCP-backed Beacon client class. Routed through the
   * environment handler so the dynamic `import("../beacon/client.js")`
   * call lives on the Node-only path — keeps Beacon's `node:net` /
   * `node:crypto` deps out of browser bundles that statically reach
   * `Configuration` (and therefore previously reached the dynamic
   * imports).
   * @returns {Promise<typeof import("../beacon/client.js").default>} - Beacon client class.
   */
  async loadBeaconClient() {
    throw new Error("loadBeaconClient not implemented by this environment handler")
  }

  /**
   * Loads the in-process Beacon client class. Same indirection rationale
   * as `loadBeaconClient`.
   * @returns {Promise<typeof import("../beacon/in-process-client.js").default>} - In-process client class.
   */
  async loadInProcessBeaconClient() {
    throw new Error("loadInProcessBeaconClient not implemented by this environment handler")
  }

  /**
   * Runs cli commands db schema dump.
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsDbSchemaDump(_command) {
    throw new Error("cliCommandsDbSchemaDump not implemented")
  }

  /**
   * Runs cli commands db schema load.
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsDbSchemaLoad(_command) {
    throw new Error("cliCommandsDbSchemaLoad not implemented")
  }

  /**
   * Runs cli commands db seed.
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsDbSeed(_command) {
    throw new Error("cliCommandsDbSeed not implemented")
  }

  /**
   * Runs cli commands runner.
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsRunner(_command) {
    throw new Error("cliCommandsRunner not implemented")
  }

  /**
   * Runs cli commands run script.
   * @param {import("../cli/base-command.js").default} _command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsRunScript(_command) {
    throw new Error("cliCommandsRunScript not implemented")
  }

  /**
   * Runs find commands.
   * @abstract
   * @returns {Promise<CommandFileObjectType[]>} - Resolves with the commands.
   */
  async findCommands() { throw new Error("findCommands not implemented") }

  /**
   * Runs find migrations.
   * @abstract
   * @returns {Promise<Array<MigrationObjectType>>} - Resolves with the migrations.
   */
  async findMigrations() { throw new Error("findMigrations not implemneted") }

  /**
   * Runs forward command.
   * @param {import("../cli/base-command.js").default} command - Command.
   * @param {typeof import("../cli/base-command.js").default} CommandClass - Command class.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async forwardCommand(command, CommandClass) {
    const newCommand = new CommandClass({
      args: command.args,
      cli: command.cli
    })

    return await newCommand.execute()
  }

  /**
   * Runs get velocious path.
   * @abstract
   * @returns {Promise<string>} - Resolves with the velocious path.
   */
  getVelociousPath() { throw new Error("getVelociousPath not implemented") }

  /**
   * Runs import application routes.
   * @abstract
   * @returns {Promise<import("../routes/index.js").default>} - Resolves with the import application routes.
   */
  async importApplicationRoutes() { throw new Error("importApplicationRoutes not implemented") }

  /**
   * Runs import test files.
   * @abstract
   * @param {string[]} _testFiles - Test files.
   * @returns {Promise<void>} - Resolves when complete.
   */
  importTestFiles(_testFiles) { throw new Error("'importTestFiles' not implemented") }

  /**
   * Runs import testing config path.
   * @abstract
   * @returns {Promise<void>} - Resolves when complete.
   */
  importTestingConfigPath() { throw new Error(`'importTestingConfigPath' not implemented`) }

  /**
   * Runs after migrations.
   * @param {object} args - Options object.
   * @param {Record<string, import("../database/drivers/base.js").default>} args.dbs - Dbs.
   * @param {"migration" | "schemaDump"} [args.reason] - Why the structure write hook is being invoked.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async afterMigrations(args) { // eslint-disable-line no-unused-vars
    return
  }

  /**
   * Runs require command.
   * @abstract
   * @param {object} args - Options object.
   * @param {string[]} args.commandParts - Command parts.
   * @returns {Promise<typeof import ("../cli/base-command.js").default>} - Resolves with the require command.
   */
  async requireCommand({commandParts}) { throw new Error("'requireCommand' not implemented") } // eslint-disable-line no-unused-vars

  /**
   * Runs set args.
   * @param {object} newArgs - New args.
   * @returns {void} - No return value.
   */
  setArgs(newArgs) { this.args = newArgs }

  /**
   * Runs set configuration.
   * @param {import("../configuration.js").default} newConfiguration - New configuration.
   * @returns {void} - No return value.
   */
  setConfiguration(newConfiguration) { this.configuration = newConfiguration }

  /**
   * Runs read attachment input file.
   * @param {string} _filePath - File path.
   * @returns {Promise<Buffer>} - File bytes.
   */
  async readAttachmentInputFile(_filePath) {
    throw new Error("Attachment file reads are not supported in this environment")
  }

  /**
   * Runs resolve attachment input path.
   * @param {object} _args - Args.
   * @param {string[]} _args.allowedPathPrefixes - Allowed path prefixes.
   * @param {string} _args.inputPath - Input path.
   * @returns {Promise<{buffer: Buffer, filePath: string}>} - Resolved path and file bytes.
   */
  async resolveAttachmentInputPath(_args) {
    throw new Error("Attachment path input is not supported in this environment")
  }

  /**
   * Runs get configuration.
   * @returns {import("../configuration.js").default} - The configuration.
   */
  getConfiguration() {
    if (!this.configuration) throw new Error("Configuration hasn't been set")

    return this.configuration
  }

  /**
   * Runs set process args.
   * @param {string[]} newProcessArgs - New process args.
   * @returns {void} - No return value.
   */
  setProcessArgs(newProcessArgs) { this.processArgs = newProcessArgs }

  /**
   * Runs get default log directory.
   * @param {object} _args - Options object.
   * @param {import("../configuration.js").default} _args.configuration - Configuration instance.
   * @returns {string | undefined} - The default log directory.
   */
  getDefaultLogDirectory(_args) {
    return undefined
  }

  /**
   * Runs get log file path.
   * @param {object} _args - Options object.
   * @param {import("../configuration.js").default} _args.configuration - Configuration instance.
   * @param {string | undefined} _args.directory - Directory path.
   * @param {string} _args.environment - Environment.
   * @returns {string | undefined} - The log file path.
   */
  getLogFilePath(_args) {
    return undefined
  }

  /**
   * Runs write log to file.
   * @param {object} _args - Options object.
   * @param {string} _args.filePath - File path.
   * @param {string} _args.message - Message text.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async writeLogToFile(_args) {
    return
  }

  /**
   * Registers frontend-model websocket channel publishers so lifecycle
   * event hooks (create/update/destroy) broadcast over the shared
   * "frontend-models" channel. The base handler is a no-op — only the
   * Node handler performs the registration because the required
   * `frontend-model-controller` and `routes/resolver` imports pull in
   * server-only modules that break browser bundlers.
   * @param {import("../configuration.js").default} _configuration - Configuration instance.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async initializeFrontendModelWebsocketPublishers(_configuration) {
    // No-op in base handler; Node handler does the real registration.
  }
}
