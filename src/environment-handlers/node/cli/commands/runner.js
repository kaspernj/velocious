import BaseCommand from "../../../../cli/base-command.js"
import path from "node:path"
import toImportSpecifier from "../../../../utils/to-import-specifier.js"

/**
 * @typedef {object} RunnerContext
 * @property {import("../../../../configuration.js").default} configuration - Configuration instance.
 * @property {import("../../../../database/drivers/base.js").default | undefined} db - Default database connection.
 * @property {Record<string, import("../../../../database/drivers/base.js").default>} dbs - Database connections keyed by identifier.
 * @property {string[]} args - CLI args after the script path.
 */

/**
 * @param {string} filePath - Absolute path to script file.
 * @returns {Promise<(context: RunnerContext) => Promise<unknown>>} - The default-exported async function.
 */
async function importRunnerFunction(filePath) {
  const runnerImport = await import(toImportSpecifier(filePath))
  const runnerFunction = runnerImport.default

  if (typeof runnerFunction !== "function") {
    throw new Error(`Expected default export to be a function in: ${filePath}`)
  }

  return runnerFunction
}

/** Node command for running a custom script file in initialized app/DB context. */
export default class RunnerCommand extends BaseCommand {
  /** @returns {Promise<unknown>} - Resolves with the script function result. */
  async execute() {
    const configuration = this.getConfiguration()
    const scriptPath = this.runnerFilePath()

    await this.initializeRuntime()
    await configuration.ensureGlobalConnections()

    try {
      const runnerFunction = await importRunnerFunction(scriptPath)

      return await runnerFunction(this.buildRunnerContext())
    } finally {
      await configuration.closeDatabaseConnections()
    }
  }

  /** @returns {Promise<void>} - Resolves when runtime initialization is complete. */
  async initializeRuntime() {
    const configuration = this.getConfiguration()

    await configuration.initialize({type: "runner"})

    if (!configuration.isDatabasePoolInitialized()) {
      configuration.initializeDatabasePool()
    }
  }

  /** @returns {string} - Absolute path to the user-provided runner script. */
  runnerFilePath() {
    const filePath = this.processArgs[1]

    if (!filePath) {
      throw new Error("Missing file path argument. Usage: npx velocious runner [file-path]")
    }

    return path.resolve(this.directory(), filePath)
  }

  /** @returns {RunnerContext} - Runtime context passed to the script function. */
  buildRunnerContext() {
    const configuration = this.getConfiguration()
    const dbs = configuration.getCurrentConnections()
    const identifiers = Object.keys(dbs)

    return {
      configuration,
      db: dbs.default || (identifiers.length > 0 ? dbs[identifiers[0]] : undefined),
      dbs,
      args: this.processArgs.slice(2)
    }
  }
}
