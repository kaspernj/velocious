import BaseCommand from "../../../../../cli/base-command.js"
import path from "node:path"
import toImportSpecifier from "../../../../../utils/to-import-specifier.js"

/**
 * @typedef {object} RunnerContext
 * @property {import("../../../../../configuration.js").default} configuration - Configuration instance.
 * @property {import("../../../../../database/drivers/base.js").default | undefined} db - Default database connection.
 * @property {Record<string, import("../../../../../database/drivers/base.js").default>} dbs - Database connections keyed by identifier.
 * @property {string[]} args - CLI args after the command name.
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

/** Node command for running project database seeds from src/db/seed.js. */
export default class DbSeed extends BaseCommand {
  /** @returns {Promise<unknown>} - Resolves with the seed function result. */
  async execute() {
    const configuration = this.getConfiguration()

    await this.initializeRuntime()
    await configuration.ensureGlobalConnections()

    try {
      const seedPath = this.seedFilePath()
      const runnerFunction = await importRunnerFunction(seedPath)

      return await runnerFunction(this.buildRunnerContext())
    } finally {
      await configuration.closeDatabaseConnections()
    }
  }

  /** @returns {Promise<void>} - Resolves when runtime initialization is complete. */
  async initializeRuntime() {
    const configuration = this.getConfiguration()

    await configuration.initialize({type: "db-seed"})

    if (!configuration.isDatabasePoolInitialized()) {
      configuration.initializeDatabasePool()
    }
  }

  /** @returns {string} - Absolute path to src/db/seed.js. */
  seedFilePath() {
    return path.join(this.directory(), "src", "db", "seed.js")
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
      args: this.processArgs.slice(1)
    }
  }
}
