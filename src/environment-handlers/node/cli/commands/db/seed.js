import BaseCommand from "../../../../../cli/base-command.js"
import buildCliCommandContext from "../cli-command-context.js"
import path from "node:path"
import toImportSpecifier from "../../../../../utils/to-import-specifier.js"

/**
 * @typedef {import("../cli-command-context.js").CliCommandContext} RunnerContext
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

    try {
      await configuration.ensureGlobalConnections()

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
    return buildCliCommandContext(this, 1)
  }
}
