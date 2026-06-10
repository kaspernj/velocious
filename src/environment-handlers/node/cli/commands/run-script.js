import BaseCommand from "../../../../cli/base-command.js"
import buildCliCommandContext from "./cli-command-context.js"
import path from "node:path"
import toImportSpecifier from "../../../../utils/to-import-specifier.js"

/**
 * RunScriptContext type.
 * @typedef {import("./cli-command-context.js").CliCommandContext} RunScriptContext
 */

/**
 * Runs import run script function.
 * @param {string} filePath - Absolute path to script file.
 * @returns {Promise<(context: RunScriptContext) => Promise<?>>} - The default-exported async function.
 */
async function importRunScriptFunction(filePath) {
  const scriptImport = await import(toImportSpecifier(filePath))
  const runScriptFunction = scriptImport.default

  if (typeof runScriptFunction !== "function") {
    throw new Error(`Expected default export to be a function in: ${filePath}`)
  }

  return runScriptFunction
}

/** Node command for running a custom script file in initialized app/DB context. */
export default class RunScriptCommand extends BaseCommand {
  /**
   * Runs execute.
   * @returns {Promise<?>} - Resolves with the script function result.
   */
  async execute() {
    const configuration = this.getConfiguration()
    const scriptPath = this.scriptFilePath()

    await this.initializeRuntime()

    try {
      await configuration.ensureGlobalConnections()

      const runScriptFunction = await importRunScriptFunction(scriptPath)

      return await runScriptFunction(this.buildRunScriptContext())
    } finally {
      await configuration.closeDatabaseConnections()
    }
  }

  /**
   * Runs initialize runtime.
   * @returns {Promise<void>} - Resolves when runtime initialization is complete.
   */
  async initializeRuntime() {
    const configuration = this.getConfiguration()

    await configuration.initialize({type: "run-script"})

    if (!configuration.isDatabasePoolInitialized()) {
      configuration.initializeDatabasePool()
    }
  }

  /**
   * Runs script file path.
   * @returns {string} - Absolute path to the user-provided script file.
   */
  scriptFilePath() {
    const filePath = this.processArgs?.[1]

    if (!filePath) {
      throw new Error("Missing file path argument. Usage: npx velocious run-script [file-path]")
    }

    return path.resolve(this.directory(), filePath)
  }

  /**
   * Runs build run script context.
   * @returns {RunScriptContext} - Runtime context passed to the script function.
   */
  buildRunScriptContext() {
    return buildCliCommandContext(this, 2)
  }
}
