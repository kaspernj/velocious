// @ts-check

import Application from "../../src/application.js"
import {digg} from "diggerize"
import dummyConfiguration from "./src/config/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import Migrator from "../../src/database/migrator.js"

export default class Dummy {
  /** @type {Dummy | undefined} */
  static velociousDummy

  static current() {
    if (!this.velociousDummy) {
      this.velociousDummy = new Dummy()
    }

    return this.velociousDummy
  }

  /** @type {boolean} */
  _migrationsDone = false

  /** @type {boolean} */
  _started = false

  /** @type {Promise<void> | undefined} */
  _startingPromise

  /** @type {Application | undefined} */
  application

  static async prepare() {
    dummyConfiguration.setCurrent()

    await dummyConfiguration.ensureConnections(async () => {
      await this.current()._runMigrationsOnce()

      if (!dummyConfiguration.isInitialized()) {
        await dummyConfiguration.initialize()
      }
    })
  }

  /**
   * Runs migrations exactly once per process. Subsequent calls are no-ops
   * so repeated Dummy.run calls don't re-query schema_migrations and reload models.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _runMigrationsOnce() {
    if (this._migrationsDone) return

    const environmentHandlerNode = new EnvironmentHandlerNode()

    environmentHandlerNode.setConfiguration(dummyConfiguration)

    const migrator = new Migrator({configuration: dummyConfiguration})

    await migrator.prepare()
    await migrator.migrateFiles(await environmentHandlerNode.findMigrations(), digg(environmentHandlerNode, "requireMigration"))

    this._migrationsDone = true
  }

  /**
   * @param {function(): Promise<any>} callback - Callback function.
   * @param {object} [options] - Options.
   * @param {boolean} [options.fresh] - Tear down any existing dummy and start a new one.
   * @returns {Promise<void>} - Resolves when complete.
   */
  static async run(callback, options) {
    await this.current().run(callback, options)
  }

  /**
   * @returns {Promise<void>} - Resolves when the dummy is fully torn down.
   */
  static async teardown() {
    if (!this.velociousDummy) return

    await this.velociousDummy.teardown()
  }

  /**
   * @param {function(): Promise<void>} callback - Callback function.
   * @param {object} [options] - Options.
   * @param {boolean} [options.fresh] - Force a full stop + restart before running.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async run(callback, options) {
    if (options?.fresh) await this.teardown()

    await dummyConfiguration.ensureConnections(async () => {
      await this.start()
      await callback()
    })
  }

  /**
   * Starts the dummy application if it isn't already running. Concurrent callers
   * share a single startup promise so the first one wins and the rest await it.
   * @returns {Promise<void>} - Resolves when started.
   */
  async start() {
    if (this._started) return
    if (this._startingPromise) {
      await this._startingPromise
      return
    }

    this._startingPromise = this._doStart()

    try {
      await this._startingPromise
    } finally {
      this._startingPromise = undefined
    }
  }

  /** @returns {Promise<void>} - Resolves when complete. */
  async _doStart() {
    await Dummy.prepare()

    if (!dummyConfiguration.isDatabasePoolInitialized()) {
      await dummyConfiguration.initializeDatabasePool()
    }

    this.application = new Application({
      configuration: dummyConfiguration,
      httpServer: {
        inProcess: true,
        maxWorkers: 1,
        port: 3006
      },
      type: "dummy"
    })

    await this.application.initialize()
    await this.application.startHttpServer()

    this._started = true
  }

  /**
   * Tears down the running application (HTTP server + DB connections). Safe to call
   * when nothing is running; resets state so a subsequent Dummy.run will do a full start again.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async teardown() {
    if (this.application) {
      await this.application.stop()
      this.application = undefined
    }

    this._started = false
    this._migrationsDone = false
  }

  /**
   * Back-compat alias: older call sites used `stop()` to mean full teardown.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async stop() {
    await this.teardown()
  }
}
