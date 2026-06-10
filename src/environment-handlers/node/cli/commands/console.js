import Application from "../../../../application.js"
import BaseCommand from "../../../../cli/base-command.js"
import path from "node:path"
import repl from "node:repl"

/**
 * Defines this typedef.
  @typedef {{application: import("../../../../application.js").default, configuration: import("../../../../configuration.js").default}} ConsoleContextArgs */

/**
 * Runs build console context.
 * @param {ConsoleContextArgs} args - Options object.
 * @returns {Record<string, ?>} - The console context.
 */
function buildConsoleContext({application, configuration}) {
  /**
   * Dbs.
    @type {Record<string, import("../../../../database/drivers/base.js").default>} */
  const dbs = configuration.getCurrentConnections()

  for (const identifier of configuration.getDatabaseIdentifiers()) {
    if (dbs[identifier]) continue

    const pool = configuration.getDatabasePool(identifier)
    const poolWithGlobal = /**
                            * Narrows the runtime value to the documented type.
                             @type {{getGlobalConnection?: () => import("../../../../database/drivers/base.js").default | undefined}} */ (pool)
    const globalConnection = poolWithGlobal.getGlobalConnection?.()

    if (globalConnection) {
      dbs[identifier] = globalConnection
      continue
    }

    try {
      dbs[identifier] = pool.getCurrentConnection()
    } catch (error) {
      if (configuration.isMissingCurrentConnectionError(error)) {
        // Ignore missing connections here; they can be established lazily.
      } else {
        throw error
      }
    }
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
 * Runs assign console context.
 * @param {object} args - Options object.
 * @param {Record<string, ?>} args.context - The base context.
 * @param {import("node:repl").REPLServer} args.replServer - The REPL server.
 * @returns {void} - No return value.
 */
function assignConsoleContext({context, replServer}) {
  Object.assign(replServer.context, context)

  const modelClasses = /**
                        * Narrows the runtime value to the documented type.
                         @type {Record<string, typeof import("../../../../database/record/index.js").default>} */ (
    context.models || {}
  )

  for (const [name, modelClass] of Object.entries(modelClasses)) {
    replServer.context[name] = modelClass
  }
}

/**
 * Runs start console repl.
 * @param {object} args - Options object.
 * @param {import("../../../../configuration.js").default} args.configuration - Configuration instance.
 * @param {Record<string, ?>} args.context - REPL context.
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
        resolve(undefined)
      }
    })
  })

  await new Promise((resolve) => {
    replServer.on("exit", () => {
      resolve(undefined)
    })
  })

}

/** Velocious console command. */
export default class VelociousCliCommandsConsole extends BaseCommand{
  /**
   * Runs execute.
   * @returns {Promise<?>} - Resolves with the command result.
   */
  async execute() {
    const configuration = this.getConfiguration()
    const application = new Application({
      configuration,
      type: "console"
    })

    await application.initialize()

    try {
      await configuration.ensureGlobalConnections()

      const context = buildConsoleContext({application, configuration})

      if (this.cli.getTesting()) {
        return {modelNames: Object.keys(context.models || {})}
      }

      return await startConsoleRepl({configuration, context})
    } finally {
      await configuration.closeDatabaseConnections()
    }
  }
}
