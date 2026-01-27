import Application from "../../../../application.js"
import BaseCommand from "../../../../cli/base-command.js"
import path from "node:path"
import repl from "node:repl"

/** @typedef {{application: import("../../../../application.js").default, configuration: import("../../../../configuration.js").default}} ConsoleContextArgs */

/**
 * @param {ConsoleContextArgs} args - Options object.
 * @returns {Record<string, unknown>} - The console context.
 */
function buildConsoleContext({application, configuration}) {
  /** @type {Record<string, import("../../../../database/drivers/base.js").default>} */
  const dbs = {}

  for (const identifier of configuration.getDatabaseIdentifiers()) {
    const pool = configuration.getDatabasePool(identifier)

    dbs[identifier] = pool.getCurrentConnection()
  }

  const dbIdentifiers = Object.keys(dbs)

  return {
    app: application,
    application,
    configuration,
    db: dbs.default || (dbIdentifiers.length > 0 ? dbs[dbIdentifiers[0]] : undefined),
    dbs,
    models: {...configuration.modelClasses}
  }
}

/**
 * @param {object} args - Options object.
 * @param {Record<string, unknown>} args.context - The base context.
 * @param {import("node:repl").REPLServer} args.replServer - The REPL server.
 * @returns {void} - No return value.
 */
function assignConsoleContext({context, replServer}) {
  Object.assign(replServer.context, context)

  const modelClasses = /** @type {Record<string, typeof import("../../../../database/record/index.js").default>} */ (
    context.models || {}
  )

  for (const [name, modelClass] of Object.entries(modelClasses)) {
    replServer.context[name] = modelClass
  }
}

/**
 * @param {object} args - Options object.
 * @param {import("../../../../configuration.js").default} args.configuration - Configuration instance.
 * @param {Record<string, unknown>} args.context - REPL context.
 * @returns {Promise<void>} - Resolves when the console exits.
 */
async function startConsoleRepl({configuration, context}) {
  const environment = configuration.getEnvironment()

  console.log(`Loading ${environment} environment (Velocious console)`)

  const replServer = repl.start({
    prompt: "velocious> "
  })

  assignConsoleContext({context, replServer})
  replServer.on("reset", () => {
    assignConsoleContext({context, replServer})
  })

  const historyPath = path.join(configuration.getDirectory(), ".velocious-console-history")

  await new Promise((resolve, reject) => {
    replServer.setupHistory(historyPath, (error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })

  await new Promise((resolve, reject) => {
    replServer.on("exit", () => {
      configuration
        .closeDatabaseConnections()
        .then(() => resolve())
        .catch((error) => {
          reject(error)
        })
    })
  })

}

/** Velocious console command. */
export default class VelociousCliCommandsConsole extends BaseCommand{
  /** @returns {Promise<unknown>} - Resolves with the command result. */
  async execute() {
    const configuration = this.getConfiguration()
    const application = new Application({
      configuration,
      type: "console"
    })

    await application.initialize()
    await configuration.ensureGlobalConnections()

    const context = buildConsoleContext({application, configuration})

    if (this.cli.getTesting()) {
      return {modelNames: Object.keys(context.models || {})}
    }

    return await startConsoleRepl({configuration, context})
  }
}
