// @ts-check

import "../database/annotations-async-hooks.js"
import Base from "./base.js"
import CliCommandsDestroyMigration from "./node/cli/commands/destroy/migration.js"
import CliCommandsInit from "./node/cli/commands/init.js"
import CliCommandsGenerateBaseModels from "./node/cli/commands/generate/base-models.js"
import CliCommandsGenerateFrontendModels from "./node/cli/commands/generate/frontend-models.js"
import CliCommandsGenerateMigration from "./node/cli/commands/generate/migration.js"
import CliCommandsGenerateModel from "./node/cli/commands/generate/model.js"
import CliCommandsLintRelationships from "./node/cli/commands/lint/relationships.js"
import CliCommandsRoutes from "./node/cli/commands/routes.js"
import CliCommandsServer from "./node/cli/commands/server.js"
import CliCommandsTest from "./node/cli/commands/test.js"
import CliCommandsBackgroundJobsMain from "./node/cli/commands/background-jobs-main.js"
import CliCommandsBackgroundJobsWorker from "./node/cli/commands/background-jobs-worker.js"
import CliCommandsBackgroundJobsRunner from "./node/cli/commands/background-jobs-runner.js"
import CliCommandsBeacon from "./node/cli/commands/beacon.js"
import CliCommandsConsole from "./node/cli/commands/console.js"
import CliCommandsDbSchemaDump from "./node/cli/commands/db/schema/dump.js"
import CliCommandsDbSchemaLoad from "./node/cli/commands/db/schema/load.js"
import CliCommandsDbSeed from "./node/cli/commands/db/seed.js"
import CliCommandsRunner from "./node/cli/commands/runner.js"
import CliCommandsRunScript from "./node/cli/commands/run-script.js"
import frontendModelCommandRouteHook from "../routes/hooks/frontend-model-command-route-hook.js"
import {FRAMEWORK_SOURCE_DIRECTORY} from "../utils/backtrace-cleaner-node.js"
import {dirname} from "path"
import {fileURLToPath} from "url"
import fs from "fs/promises"
import * as inflection from "inflection"
import path from "path"
import {AsyncLocalStorage as NodeAsyncLocalStorage} from "node:async_hooks"
import {timingSafeEqual} from "node:crypto"
import requireContext from "require-context"
import InitializerFromRequireContext from "../database/initializer-from-require-context.js"
import toImportSpecifier from "../utils/to-import-specifier.js"
import {validateTimeZone} from "../time-zone.js"

/**
 * Defines this typedef.
 * @typedef {{ability?: import("../authorization/ability.js").default, offsetMinutes: number, requestTiming?: import("../http-server/client/request-timing.js").default, tenant?: ?, timeZone?: string}} TimezoneStore */

/**
 * Runs path within allowed prefixes.
 * @param {string} filePath - Input file path.
 * @param {string[]} allowedPathPrefixes - Allowed path prefixes.
 * @returns {boolean} - Whether input path is inside an allowed prefix.
 */
function pathWithinAllowedPrefixes(filePath, allowedPathPrefixes) {
  const resolvedPath = path.resolve(filePath)

  return allowedPathPrefixes.some((allowedPrefix) => {
    const resolvedPrefix = path.resolve(allowedPrefix)
    const relativePath = path.relative(resolvedPrefix, resolvedPath)

    if (!relativePath) return true
    if (relativePath.startsWith("..")) return false
    if (path.isAbsolute(relativePath)) return false

    return true
  })
}

export default class VelociousEnvironmentHandlerNode extends Base{
  /**
   * Timezone async local storage.
   * @type {import("node:async_hooks").AsyncLocalStorage<TimezoneStore> | undefined} */
  _timezoneAsyncLocalStorage = NodeAsyncLocalStorage ? new NodeAsyncLocalStorage() : undefined

  /**
   * Find commands result.
   * @type {import("./base.js").CommandFileObjectType[] | undefined} */
  _findCommandsResult = undefined

  /**
   * Runs debug endpoint token matches.
   * @param {string} providedToken - Token from the request.
   * @param {string} expectedToken - Configured token.
   * @returns {boolean} - Whether both tokens match.
   */
  debugEndpointTokenMatches(providedToken, expectedToken) {
    const provided = Buffer.from(providedToken)
    const expected = Buffer.from(expectedToken)

    return provided.length === expected.length && timingSafeEqual(provided, expected)
  }

  /**
   * Runs get framework source directory.
   * @returns {string | undefined} - Velocious source directory used to filter framework stack frames.
   */
  getFrameworkSourceDirectory() {
    return FRAMEWORK_SOURCE_DIRECTORY
  }

  /**
   * Auto-discovers resource classes from src/resources/ in each backend project.
   * @param {import("../configuration.js").default} configuration - Configuration instance.
   * @returns {Promise<void>}
   */
  async autoDiscoverResources(configuration) {
    const {frontendModelResourceDefinitionIsClass} = await import("../frontend-models/resource-definition.js")
    const backendProjects = configuration.getBackendProjects()

    for (const backendProject of backendProjects) {
      if (backendProject.frontendModels) continue

      const resourcesDir = backendProject.resourcesPath || path.join(backendProject.path, "src", "resources")
      let files

      try {
        files = await fs.readdir(resourcesDir)
      } catch {
        continue
      }

      /**
       * Discovered.
       * @type {Record<string, ?>} */
      const discovered = {}

      for (const file of files) {
        if (!file.endsWith(".js") && !file.endsWith(".mjs")) continue
        if (file.startsWith("frontend-model-resources")) continue

        const filePath = path.join(resourcesDir, file)
        const imported = await import(filePath)
        const ResourceClass = imported.default

        if (!frontendModelResourceDefinitionIsClass(ResourceClass)) continue
        // Skip abstract/common base resources that declare no `ModelClass` — they are
        // not models, so they must not be recorded as discovered frontend models.
        if (!ResourceClass.ModelClass) continue

        const baseName = file.replace(/\.(js|mjs)$/, "")
        const modelName = baseName.replace(/-resource$/, "")
          .split("-")
          .map((/** @type {string} */ part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join("")

        discovered[modelName] = ResourceClass
      }

      if (Object.keys(discovered).length > 0) {
        backendProject.frontendModels = discovered
      }
    }
  }

  /**
   * Loads models contributed by registered packages into the model registry,
   * after the app's own `initializeModels` hook. A package whose models directory
   * is absent is skipped; a package model whose name collides with an
   * already-registered different class throws. Node-only (uses the filesystem), so
   * it lives here rather than in the browser-bundled Configuration.
   * @param {import("../configuration.js").default} configuration - Configuration instance.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async initializePackageModels(configuration) {
    for (const velociousPackage of configuration.getPackages()) {
      const modelsPath = velociousPackage.getModelsPath()

      try {
        await fs.access(modelsPath)
      } catch {
        continue
      }

      const packageRequireContext = /** @type {import("../database/initializer-from-require-context.js").ModelClassRequireContextType} */ (requireContext(modelsPath, true, /^(.+)\.js$/))
      const modelClasses = configuration.getModelClasses()

      for (const fileName of packageRequireContext.keys()) {
        const modelClass = packageRequireContext(fileName)?.default
        const existing = modelClass && modelClasses[modelClass.getModelName()]

        if (existing && existing !== modelClass) {
          throw new Error(`Package "${velociousPackage.getName()}" model "${modelClass.getModelName()}" collides with an already-registered model.`)
        }
      }

      await configuration.ensureConnections({name: `Initialize ${velociousPackage.getName()} package models`}, async () => {
        await new InitializerFromRequireContext({requireContext: packageRequireContext}).initialize({configuration})
      })
    }
  }

  /**
   * Runs set configuration.
   * @param {import("../configuration.js").default} newConfiguration - New configuration.
   * @returns {void} - No return value.
   */
  setConfiguration(newConfiguration) {
    super.setConfiguration(newConfiguration)

    if (!newConfiguration.getRouteResolverHooks().includes(frontendModelCommandRouteHook)) {
      newConfiguration.addRouteResolverHook(frontendModelCommandRouteHook)
    }
  }

  /**
   * Runs read attachment input file.
   * @param {string} filePath - File path.
   * @returns {Promise<Buffer>} - File bytes.
   */
  async readAttachmentInputFile(filePath) {
    return await fs.readFile(filePath)
  }

  /**
   * Runs resolve attachment input path.
   * @param {object} args - Args.
   * @param {string[]} args.allowedPathPrefixes - Allowed path prefixes.
   * @param {string} args.inputPath - Input path.
   * @returns {Promise<{buffer: Buffer, filePath: string}>} - Resolved path and bytes.
   */
  async resolveAttachmentInputPath({allowedPathPrefixes, inputPath}) {
    const filePath = path.resolve(inputPath)
    const prefixes = Array.isArray(allowedPathPrefixes)
      ? allowedPathPrefixes.filter((entry) => typeof entry === "string" && entry.length > 0)
      : []

    if (prefixes.length > 0 && !pathWithinAllowedPrefixes(filePath, prefixes)) {
      throw new Error("Attachment path is outside allowed directories")
    }

    const buffer = await this.readAttachmentInputFile(filePath)

    return {buffer, filePath}
  }

  /**
   * Runs find commands.
   * @returns {Promise<Array<import("./base.js").CommandFileObjectType>>} - Resolves with the commands.
   */
  async findCommands() {
    this._findCommandsResult ||= await this._actualFindCommands()

    if (!this._findCommandsResult) throw new Error("Could not get commands")

    return this._findCommandsResult
  }

  /**
   * Runs run with timezone offset.
   * @param {number} offsetMinutes - Offset in minutes (Date#getTimezoneOffset).
   * @param {() => Promise<?>} callback - Callback to run.
   * @returns {Promise<?>} - Result of the callback.
   */
  async runWithTimezoneOffset(offsetMinutes, callback) {
    if (!this._timezoneAsyncLocalStorage) {
      return await callback()
    }

    const existingStore = this._timezoneAsyncLocalStorage.getStore()

    return await this._timezoneAsyncLocalStorage.run({
      ability: existingStore?.ability,
      offsetMinutes,
      requestTiming: existingStore?.requestTiming,
      tenant: existingStore?.tenant,
      timeZone: existingStore?.timeZone ?? this.getTimeZone(this.getConfiguration())
    }, callback)
  }

  /**
   * Runs run with timezone.
   * @param {string} timeZone - IANA timezone identifier.
   * @param {() => Promise<?>} callback - Callback to run.
   * @returns {Promise<?>} - Result of the callback.
   */
  async runWithTimezone(timeZone, callback) {
    if (!this._timezoneAsyncLocalStorage) {
      return await super.runWithTimezone(timeZone, callback)
    }

    const existingStore = this._timezoneAsyncLocalStorage.getStore()

    return await this._timezoneAsyncLocalStorage.run({
      ability: existingStore?.ability,
      offsetMinutes: existingStore?.offsetMinutes ?? this.getTimezoneOffsetMinutes(this.getConfiguration()),
      requestTiming: existingStore?.requestTiming,
      tenant: existingStore?.tenant,
      timeZone: validateTimeZone(timeZone, "timeZone")
    }, callback)
  }

  /**
   * Runs set timezone offset.
   * @param {number} offsetMinutes - Offset in minutes (Date#getTimezoneOffset).
   * @returns {void} - No return value.
   */
  setTimezoneOffset(offsetMinutes) {
    if (!this._timezoneAsyncLocalStorage) return

    const store = this._timezoneAsyncLocalStorage.getStore()

    if (store) {
      store.offsetMinutes = offsetMinutes
    } else {
      const existingStore = this._timezoneAsyncLocalStorage.getStore()

      this._timezoneAsyncLocalStorage.enterWith({
        ability: existingStore?.ability,
        offsetMinutes,
        requestTiming: existingStore?.requestTiming,
        tenant: existingStore?.tenant,
        timeZone: existingStore?.timeZone ?? this.getTimeZone(this.getConfiguration())
      })
    }
  }

  /**
   * Runs set timezone.
   * @param {string} timeZone - IANA timezone identifier.
   * @returns {void} - No return value.
   */
  setTimezone(timeZone) {
    if (!this._timezoneAsyncLocalStorage) {
      super.setTimezone(timeZone)
      return
    }

    const normalizedTimeZone = validateTimeZone(timeZone, "timeZone")
    const store = this._timezoneAsyncLocalStorage.getStore()

    if (store) {
      store.timeZone = normalizedTimeZone
    } else {
      const existingStore = this._timezoneAsyncLocalStorage.getStore()

      this._timezoneAsyncLocalStorage.enterWith({
        ability: existingStore?.ability,
        offsetMinutes: existingStore?.offsetMinutes ?? this.getTimezoneOffsetMinutes(this.getConfiguration()),
        requestTiming: existingStore?.requestTiming,
        tenant: existingStore?.tenant,
        timeZone: normalizedTimeZone
      })
    }
  }

  /**
   * Runs get timezone offset minutes.
   * @param {import("../configuration.js").default | undefined} configuration - Configuration instance.
   * @returns {number} - Offset in minutes.
   */
  getTimezoneOffsetMinutes(configuration) {
    if (this._timezoneAsyncLocalStorage) {
      const store = this._timezoneAsyncLocalStorage.getStore()

      if (store && typeof store.offsetMinutes === "number") {
        return store.offsetMinutes
      }
    }

    return super.getTimezoneOffsetMinutes(configuration)
  }

  /**
   * Runs get timezone.
   * @param {import("../configuration.js").default | undefined} configuration - Configuration instance.
   * @returns {string | undefined} - Timezone identifier.
   */
  getTimeZone(configuration) {
    if (this._timezoneAsyncLocalStorage) {
      const store = this._timezoneAsyncLocalStorage.getStore()

      if (store && typeof store.timeZone === "string") {
        return store.timeZone
      }
    }

    return super.getTimeZone(configuration)
  }

  /**
   * Runs run with ability.
   * @param {import("../authorization/ability.js").default | undefined} ability - Ability to set for callback scope.
   * @param {() => Promise<?>} callback - Callback.
   * @returns {Promise<?>} - Callback result.
   */
  async runWithAbility(ability, callback) {
    if (!this._timezoneAsyncLocalStorage) {
      return await super.runWithAbility(ability, callback)
    }

    const existingStore = this._timezoneAsyncLocalStorage.getStore()

    return await this._timezoneAsyncLocalStorage.run({
      ability,
      offsetMinutes: existingStore?.offsetMinutes ?? this.getTimezoneOffsetMinutes(this.getConfiguration()),
      requestTiming: existingStore?.requestTiming,
      tenant: existingStore?.tenant,
      timeZone: existingStore?.timeZone ?? this.getTimeZone(this.getConfiguration())
    }, callback)
  }

  /**
   * Runs set current ability.
   * @param {import("../authorization/ability.js").default | undefined} ability - Ability to set.
   * @returns {void} - No return value.
   */
  setCurrentAbility(ability) {
    if (!this._timezoneAsyncLocalStorage) {
      super.setCurrentAbility(ability)
      return
    }

    const existingStore = this._timezoneAsyncLocalStorage.getStore()

    if (existingStore) {
      existingStore.ability = ability
    } else {
      this._timezoneAsyncLocalStorage.enterWith({
        ability,
        offsetMinutes: this.getTimezoneOffsetMinutes(this.getConfiguration()),
        requestTiming: undefined,
        tenant: undefined,
        timeZone: this.getTimeZone(this.getConfiguration())
      })
    }
  }

  /**
   * Runs get current ability.
   * @returns {import("../authorization/ability.js").default | undefined} - Current ability.
   */
  getCurrentAbility() {
    if (!this._timezoneAsyncLocalStorage) {
      return super.getCurrentAbility()
    }

    return this._timezoneAsyncLocalStorage.getStore()?.ability
  }

  /**
   * Runs run with request timing.
   * @param {import("../http-server/client/request-timing.js").default | undefined} requestTiming - Request timing collector.
   * @param {() => Promise<?>} callback - Callback.
   * @returns {Promise<?>} - Callback result.
   */
  async runWithRequestTiming(requestTiming, callback) {
    if (!this._timezoneAsyncLocalStorage) {
      return await super.runWithRequestTiming(requestTiming, callback)
    }

    const existingStore = this._timezoneAsyncLocalStorage.getStore()

    return await this._timezoneAsyncLocalStorage.run({
      ability: existingStore?.ability,
      offsetMinutes: existingStore?.offsetMinutes ?? this.getTimezoneOffsetMinutes(this.getConfiguration()),
      requestTiming,
      tenant: existingStore?.tenant,
      timeZone: existingStore?.timeZone ?? this.getTimeZone(this.getConfiguration())
    }, callback)
  }

  /**
   * Runs get current request timing.
   * @returns {import("../http-server/client/request-timing.js").default | undefined} - Current request timing collector.
   */
  getCurrentRequestTiming() {
    if (!this._timezoneAsyncLocalStorage) {
      return super.getCurrentRequestTiming()
    }

    return this._timezoneAsyncLocalStorage.getStore()?.requestTiming
  }

  /**
   * Runs run with tenant.
   * @param {?} tenant - Tenant to set for callback scope.
   * @param {() => Promise<?>} callback - Callback.
   * @returns {Promise<?>} - Callback result.
   */
  async runWithTenant(tenant, callback) {
    if (!this._timezoneAsyncLocalStorage) {
      return await super.runWithTenant(tenant, callback)
    }

    const existingStore = this._timezoneAsyncLocalStorage.getStore()

    return await this._timezoneAsyncLocalStorage.run({
      ability: existingStore?.ability,
      offsetMinutes: existingStore?.offsetMinutes ?? this.getTimezoneOffsetMinutes(this.getConfiguration()),
      requestTiming: existingStore?.requestTiming,
      tenant,
      timeZone: existingStore?.timeZone ?? this.getTimeZone(this.getConfiguration())
    }, callback)
  }

  /**
   * Runs set current tenant.
   * @param {?} tenant - Tenant to set.
   * @returns {void} - No return value.
   */
  setCurrentTenant(tenant) {
    if (!this._timezoneAsyncLocalStorage) {
      super.setCurrentTenant(tenant)
      return
    }

    const existingStore = this._timezoneAsyncLocalStorage.getStore()

    if (existingStore) {
      existingStore.tenant = tenant
    } else {
      this._timezoneAsyncLocalStorage.enterWith({
        ability: undefined,
        offsetMinutes: this.getTimezoneOffsetMinutes(this.getConfiguration()),
        requestTiming: undefined,
        tenant,
        timeZone: this.getTimeZone(this.getConfiguration())
      })
    }
  }

  /**
   * Runs get current tenant.
   * @returns {?} - Current tenant.
   */
  getCurrentTenant() {
    if (!this._timezoneAsyncLocalStorage) {
      return super.getCurrentTenant()
    }

    return this._timezoneAsyncLocalStorage.getStore()?.tenant
  }

  /**
   * Runs actual find commands.
   * @returns {Promise<Array<import("./base.js").CommandFileObjectType>>} - Resolves with discovered command files.
   */
  async _actualFindCommands() {
    const basePath = await this.getBasePath()
    const commandFiles = fs.glob(`${basePath}/src/cli/commands/**/*.js`)
    const commands = []

    for await (const aFilePath of commandFiles) {
      const commandName = this.commandNameFromFilePath(aFilePath)

      commands.push({name: commandName, file: aFilePath})
    }

    return commands
  }

  /**
   * Runs command name from file path.
   * @param {string} filePath - Full command file path.
   * @returns {string} - Parsed command name.
   */
  commandNameFromFilePath(filePath) {
    const aFilePathParts = filePath.split(/[\\/]/)
    const commandPathLocation = aFilePathParts.indexOf("commands")

    if (commandPathLocation === -1) {
      throw new Error(`Could not parse command file path: ${filePath}`)
    }

    const commandParts = aFilePathParts.slice(commandPathLocation + 1)
    const lastPart = commandParts[commandParts.length - 1]
    let name, paths

    if (lastPart == "index.js") {
      name = commandParts[commandParts.length - 2]
      paths = commandParts.slice(0, -2)
    } else {
      name = lastPart.replace(".js", "")
      paths = commandParts.slice(0, -1)
    }

    return `${paths.join(":")}${paths.length > 0 ? ":" : ""}${name}`
  }

  /**
   * Runs cli commands init.
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsInit(command) {
    return await this.forwardCommand(command, CliCommandsInit)
  }

  /**
   * Runs cli commands migration generate.
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsMigrationGenerate(command) {
    return await this.forwardCommand(command, CliCommandsGenerateMigration)
  }

  /**
   * Runs cli commands migration destroy.
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsMigrationDestroy(command) {
    return await this.forwardCommand(command, CliCommandsDestroyMigration)
  }

  /**
   * Runs cli commands generate base models.
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsGenerateBaseModels(command) {
    return await this.forwardCommand(command, CliCommandsGenerateBaseModels)
  }

  /**
   * Runs cli commands generate frontend models.
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsGenerateFrontendModels(command) {
    return await this.forwardCommand(command, CliCommandsGenerateFrontendModels)
  }

  /**
   * Runs cli commands generate model.
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsGenerateModel(command) {
    return await this.forwardCommand(command, CliCommandsGenerateModel)
  }

  /**
   * Runs cli commands lint relationships.
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsLintRelationships(command) {
    return await this.forwardCommand(command, CliCommandsLintRelationships)
  }

  /**
   * Runs cli commands routes.
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsRoutes(command) {
    return await this.forwardCommand(command, CliCommandsRoutes)
  }

  /**
   * Runs cli commands console.
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsConsole(command) {
    return await this.forwardCommand(command, CliCommandsConsole)
  }

  /**
   * Runs cli commands server.
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsServer(command) {
    return await this.forwardCommand(command, CliCommandsServer)
  }

  /**
   * Runs cli commands test.
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsTest(command) {
    return await this.forwardCommand(command, CliCommandsTest)
  }

  /**
   * Runs cli commands background jobs main.
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsBackgroundJobsMain(command) {
    return await this.forwardCommand(command, CliCommandsBackgroundJobsMain)
  }

  /**
   * Runs cli commands background jobs worker.
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsBackgroundJobsWorker(command) {
    return await this.forwardCommand(command, CliCommandsBackgroundJobsWorker)
  }

  /**
   * Runs cli commands background jobs runner.
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsBackgroundJobsRunner(command) {
    return await this.forwardCommand(command, CliCommandsBackgroundJobsRunner)
  }

  /**
   * Runs cli commands beacon.
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsBeacon(command) {
    return await this.forwardCommand(command, CliCommandsBeacon)
  }

  /**
   * Runs load beacon client.
   * @returns {Promise<typeof import("../beacon/client.js").default>} - Beacon client class.
   */
  async loadBeaconClient() {
    const {default: BeaconClient} = await import("../beacon/client.js")

    return BeaconClient
  }

  /**
   * Runs load in process beacon client.
   * @returns {Promise<typeof import("../beacon/in-process-client.js").default>} - In-process client class.
   */
  async loadInProcessBeaconClient() {
    const {default: InProcessBeaconClient} = await import("../beacon/in-process-client.js")

    return InProcessBeaconClient
  }

  /**
   * Runs cli commands db schema dump.
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsDbSchemaDump(command) {
    return await this.forwardCommand(command, CliCommandsDbSchemaDump)
  }

  /**
   * Runs cli commands db schema load.
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsDbSchemaLoad(command) {
    return await this.forwardCommand(command, CliCommandsDbSchemaLoad)
  }

  /**
   * Runs cli commands db seed.
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsDbSeed(command) {
    return await this.forwardCommand(command, CliCommandsDbSeed)
  }

  /**
   * Runs cli commands runner.
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsRunner(command) {
    return await this.forwardCommand(command, CliCommandsRunner)
  }

  /**
   * Runs cli commands run script.
   * @param {import("../cli/base-command.js").default} command - Command.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async cliCommandsRunScript(command) {
    return await this.forwardCommand(command, CliCommandsRunScript)
  }

  /**
   * Runs require command.
   * @param {object} args - Options object.
   * @param {string[]} args.commandParts - Command parts.
   * @returns {Promise<typeof import ("../cli/base-command.js").default>} - Resolves with the require command.
   */
  async requireCommand({commandParts}) {
    const commands = await this.findCommands()
    const commandName = commandParts.join(":")
    const command = commands.find((aCommand) => aCommand.name === commandName)

    if (!command) {
      const possibleCommands = commands.map(aCommand => aCommand.name)

      throw new Error(`Unknown command: ${commandParts.join(":")} which should have been one of: ${possibleCommands.sort().join(", ")}`)
    }

    const commandClassImport = await import(toImportSpecifier(command.file))
    const CommandClass = commandClassImport.default

    return CommandClass
  }

  /**
   * Runs find migrations.
   * @returns {Promise<Array<import("./base.js").MigrationObjectType>>} - Resolves with the migrations.
   */
  async findMigrations() {
    const configuration = this.getConfiguration()
    const migrationDirectories = [`${configuration.getDirectory()}/src/database/migrations`]

    for (const velociousPackage of configuration.getPackages()) {
      migrationDirectories.push(velociousPackage.getMigrationsPath())
    }

    /** @type {Array<import("./base.js").MigrationObjectType>} */
    const files = []

    for (const migrationsPath of migrationDirectories) {
      await this._collectMigrationsFromDirectory(migrationsPath, files)
    }

    this._ensureNoMigrationTimestampCollisions(files)

    return files.sort((migration1, migration2) => migration1.date - migration2.date)
  }

  /**
   * Collects migration files from one directory into `files`, preserving each
   * file's real absolute path (so app and package migrations keep their own
   * source location). A missing directory is skipped.
   * @param {string} migrationsPath - Directory to scan.
   * @param {Array<import("./base.js").MigrationObjectType>} files - Accumulator to push into.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _collectMigrationsFromDirectory(migrationsPath, files) {
    const glob = await fs.glob(`${migrationsPath}/**/*.js`)

    try {
      for await (const fullPath of glob) {
        const file = await path.basename(fullPath)
        const match = file.match(/^(\d{14})-(.+)\.js$/)

        if (!match) continue

        const date = parseInt(match[1])
        const migrationName = match[2]
        const migrationClassName = inflection.camelize(migrationName.replaceAll("-", "_"))

        files.push({file, fullPath, date, migrationClassName})
      }
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error)?.code !== "ENOENT") {
        throw error
      }
    }
  }

  /**
   * Throws if two migrations from different files share the same 14-digit
   * timestamp. The `schema_migrations` ledger keys on the timestamp, so a silent
   * collision (e.g. between the app and a package, or two packages) would leave
   * the second migration un-run — a data bug. Fail loudly instead.
   * @param {Array<import("./base.js").MigrationObjectType>} files - Collected migrations.
   * @returns {void} - No return value.
   */
  _ensureNoMigrationTimestampCollisions(files) {
    /** @type {Map<number, string>} */
    const pathsByDate = new Map()

    for (const migration of files) {
      if (!migration.fullPath) continue

      const existing = pathsByDate.get(migration.date)

      if (existing && existing !== migration.fullPath) {
        throw new Error(`Two migrations share the timestamp ${migration.date}: ${existing} and ${migration.fullPath}. Migration timestamps must be unique across the app and all packages.`)
      }

      pathsByDate.set(migration.date, migration.fullPath)
    }
  }

  /**
   * Runs import application routes.
   * @returns {Promise<import("../routes/index.js").default>} - Resolves with the import application routes.
   */
  async importApplicationRoutes() {
    const routesImport = await import(toImportSpecifier(`${this.getConfiguration().getDirectory()}/src/config/routes.js`))

    return routesImport.default
  }

  /**
   * Runs get velocious path.
   * @returns {Promise<string>} - Resolves with the velocious path.
   */
  async getVelociousPath() {
    if (!this._velociousPath) {
      const __filename = fileURLToPath(import.meta.url)
      const __dirname = dirname(__filename)

      this._velociousPath = await fs.realpath(`${__dirname}/../..`)
    }

    return this._velociousPath
  }

  /**
   * Runs import test files.
   * @param {string[]} testFiles - Test files.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async importTestFiles(testFiles) {
    for (const testFile of testFiles) {
      await import(toImportSpecifier(testFile))
    }
  }

  /**
   * Runs get default log directory.
   * @param {object} args - Options object.
   * @param {import("../configuration.js").default} args.configuration - Configuration instance.
   * @returns {string} - The default log directory.
   */
  getDefaultLogDirectory({configuration}) {
    return path.join(configuration.getDirectory(), "log")
  }

  /**
   * Runs get log file path.
   * @param {object} args - Options object.
   * @param {import("../configuration.js").default} args.configuration - Configuration instance.
   * @param {string | undefined} args.directory - Directory path.
   * @param {string} args.environment - Environment.
   * @returns {string | undefined} - The log file path.
   */
  getLogFilePath({configuration, directory, environment}) {
    const actualDirectory = directory || configuration?.getDirectory?.()

    if (!actualDirectory) return undefined

    return path.join(actualDirectory, `${environment}.log`)
  }

  /**
   * Runs write log to file.
   * @param {object} args - Options object.
   * @param {string} args.filePath - File path.
   * @param {string} args.message - Message text.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async writeLogToFile({filePath, message}) {
    await fs.mkdir(path.dirname(filePath), {recursive: true})
    await fs.appendFile(filePath, `${message}\n`, "utf8")
  }

  async importTestingConfigPath() {
    const testingConfigPath = this.getConfiguration().getTesting()

    if (!testingConfigPath) return

    const testingImport = await import(toImportSpecifier(testingConfigPath))
    const testingDefault = testingImport.default

    if (!testingDefault) throw new Error("Testing config must export a default function")
    if (typeof testingDefault !== "function") throw new Error("Testing config default export isn't a function")

    const result = await testingDefault()

    if (typeof result === "function") {
      await result()
    }
  }

  /**
   * Runs require migration.
   * @param {string} filePath - File path.
   * @returns {Promise<import("../database/migration/index.js").default>} - Resolves with the require migration.
   */
  async requireMigration(filePath) {
    const migrationImport = await import(toImportSpecifier(filePath))
    const migrationImportDefault = migrationImport.default

    if (!migrationImportDefault) throw new Error("Migration file must export a default migration class")
    if (typeof migrationImportDefault !== "function") throw new Error("Migration default export isn't a function (should be a class which is a function in JS)")

    return migrationImportDefault
  }

  async getBasePath() {
    const __filename = fileURLToPath(import.meta.url)
    const basePath = await fs.realpath(`${dirname(__filename)}/../..`)

    return basePath
  }

  /**
   * Runs after migrations.
   * @param {object} args - Options object.
   * @param {Record<string, import("../database/drivers/base.js").default>} args.dbs - Dbs.
   * @param {"migration" | "schemaDump"} [args.reason] - Why the structure write is being triggered.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async afterMigrations({dbs, reason = "migration"}) {
    const configuration = this.getConfiguration()

    if (!configuration.shouldWriteStructureSql({reason})) return

    const dbDir = path.join(configuration.getDirectory(), "db")
    const structureSqlByIdentifier = await this._structureSqlByIdentifier({dbs})

    await fs.mkdir(dbDir, {recursive: true})

    for (const identifier of Object.keys(structureSqlByIdentifier)) {
      const structureSql = structureSqlByIdentifier[identifier]

      if (!structureSql) continue

      const filePath = path.join(dbDir, `structure-${identifier}.sql`)

      await fs.writeFile(filePath, structureSql)
    }
  }

  /**
   * Runs structure sql by identifier.
   * @param {object} args - Options object.
   * @param {Record<string, import("../database/drivers/base.js").default>} args.dbs - Dbs.
   * @returns {Promise<Record<string, string>>} - Resolves with SQL string.
   */
  async _structureSqlByIdentifier({dbs}) {
    const sqlByIdentifier = /** @type {Record<string, string>} */ ({})

    for (const identifier of Object.keys(dbs)) {
      const db = dbs[identifier]

      if (typeof db.structureSql !== "function") continue

      const structureSql = await db.structureSql()

      if (structureSql) {
        sqlByIdentifier[identifier] = structureSql
      }
    }

    return sqlByIdentifier
  }

  /**
   * Registers frontend-model websocket channel publishers so lifecycle
   * event hooks broadcast over the shared "frontend-models" channel.
   * This is only implemented by the Node handler because the required
   * modules (`frontend-model-controller`, `routes/resolver`) pull in
   * server-only Node APIs that break browser bundlers.
   * @param {import("../configuration.js").default} configuration - Configuration instance.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async initializeFrontendModelWebsocketPublishers(configuration) {
    // Discover each backend project's resources before registering publishers. The publishers are
    // derived from `backendProject.frontendModels`, which `autoDiscoverResources` populates. Without
    // this, registration runs against an empty/partial resource set (only built-ins), so apps that
    // resolve resources through an `abilityResolver` rather than a static ability-resource list never
    // register lifecycle publishers and their realtime frontend-model updates silently stop. The
    // lifecycle hooks are deduped per model class via a process-global set, so a later, fully
    // discovered pass cannot retroactively add the missing publishers. `autoDiscoverResources` is
    // idempotent (it skips backend projects whose `frontendModels` are already set).
    await this.autoDiscoverResources(configuration)

    const {ensureFrontendModelWebsocketPublishersRegistered} = await import("../frontend-models/websocket-publishers.js")

    await ensureFrontendModelWebsocketPublishersRegistered(configuration)
  }
}
