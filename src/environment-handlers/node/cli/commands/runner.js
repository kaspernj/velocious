import BaseCommand from "../../../../cli/base-command.js"
import buildCliCommandContext from "./cli-command-context.js"

/**
 * RunnerContext type.
 * @typedef {import("./cli-command-context.js").CliCommandContext} RunnerContext
 */

/** Node command for evaluating inline JavaScript in initialized app/DB context. */
export default class RunnerCommand extends BaseCommand {
  /**
 * Runs execute.
 * @returns {Promise<?>} - Resolves with the evaluated code result. */
  async execute() {
    const configuration = this.getConfiguration()
    const code = this.runnerCode()

    await this.initializeRuntime()

    try {
      await configuration.ensureGlobalConnections()

      return await this.evaluateCode(code)
    } finally {
      await configuration.closeDatabaseConnections()
    }
  }

  /**
 * Runs initialize runtime.
 * @returns {Promise<void>} - Resolves when runtime initialization is complete. */
  async initializeRuntime() {
    const configuration = this.getConfiguration()

    await configuration.initialize({type: "runner"})

    if (!configuration.isDatabasePoolInitialized()) {
      configuration.initializeDatabasePool()
    }
  }

  /**
 * Runs runner code.
 * @returns {string} - Inline JavaScript code to evaluate. */
  runnerCode() {
    const code = (this.processArgs || []).slice(1).join(" ").trim()

    if (!code) {
      throw new Error("Missing code argument. Usage: npx velocious runner \"<javascript-code>\"")
    }

    return code
  }

  /**
 * Runs build runner context.
 * @returns {RunnerContext} - Runtime context passed to evaluated code. */
  buildRunnerContext() {
    return buildCliCommandContext(this, 2)
  }

  /**
 * Runs evaluate code.
   * @param {string} code - JavaScript code to evaluate.
   * @returns {Promise<?>} - Evaluated code result.
   */
  async evaluateCode(code) {
    const context = this.buildRunnerContext()
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
    const runFunction = new AsyncFunction(
      "configuration",
      "db",
      "dbs",
      "args",
      code
    )

    return await runFunction(context.configuration, context.db, context.dbs, context.args)
  }
}
