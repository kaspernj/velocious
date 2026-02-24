import BaseCommand from "../../../../cli/base-command.js"

/**
 * @typedef {object} RunnerContext
 * @property {import("../../../../configuration.js").default} configuration - Configuration instance.
 * @property {import("../../../../database/drivers/base.js").default | undefined} db - Default database connection.
 * @property {Record<string, import("../../../../database/drivers/base.js").default>} dbs - Database connections keyed by identifier.
 * @property {string[]} args - CLI args after the code expression.
 */

/** Node command for evaluating inline JavaScript in initialized app/DB context. */
export default class RunnerCommand extends BaseCommand {
  /** @returns {Promise<unknown>} - Resolves with the evaluated code result. */
  async execute() {
    const configuration = this.getConfiguration()
    const code = this.runnerCode()

    await this.initializeRuntime()
    await configuration.ensureGlobalConnections()

    try {
      return await this.evaluateCode(code)
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

  /** @returns {string} - Inline JavaScript code to evaluate. */
  runnerCode() {
    const code = this.processArgs.slice(1).join(" ").trim()

    if (!code) {
      throw new Error("Missing code argument. Usage: npx velocious runner \"<javascript-code>\"")
    }

    return code
  }

  /** @returns {RunnerContext} - Runtime context passed to evaluated code. */
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

  /**
   * @param {string} code - JavaScript code to evaluate.
   * @returns {Promise<unknown>} - Evaluated code result.
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
