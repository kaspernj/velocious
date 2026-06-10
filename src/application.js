// @ts-check

import AppRoutes from "./routes/app-routes.js"
import Logger from "./logger.js"
import HttpServer from "./http-server/index.js"
import HttpServerLock from "./http-server/server-lock.js"
import websocketEventsHost from "./http-server/websocket-events-host.js"
import restArgsError from "./utils/rest-args-error.js"

/** @typedef {import("./configuration-types.js").HttpServerConfiguration} HttpServerConfiguration */

export default class VelociousApplication {
  /**
   * @param {object} args - Options object.
   * @param {import("./configuration.js").default} args.configuration - Configuration instance.
   * @param {HttpServerConfiguration} [args.httpServer] - Http server.
   * @param {string} args.type - Type identifier.
   */
  constructor({configuration, httpServer, type, ...restArgs}) {
    restArgsError(restArgs)

    if (!configuration) throw new Error("configuration is required")

    this.configuration = configuration

    /** @type {HttpServerConfiguration} */
    this.httpServerConfiguration = httpServer ?? {}

    this.logger = new Logger(this)
    this._type = type
    /** @type {HttpServerLock | undefined} */
    this.httpServerLock = undefined
  }

  /** @returns {string} - The type.  */
  getType() { return this._type }

  /** @returns {Promise<void>} - Resolves when complete.  */
  async initialize() {
    const routes = await AppRoutes.getRoutes(this.configuration)

    await this.configuration.initialize({type: this.getType()})

    this.configuration.setRoutes(routes)

    if (!this.configuration.isDatabasePoolInitialized()) {
      await this.configuration.initializeDatabasePool()
    }

  }

  /** @returns {boolean} - Whether active.  */
  isActive() {
    if (this.httpServer) {
      return this.httpServer?.isActive()
    }

    return false
  }

  /**
   * @param {function() : void} callback - Callback function.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async run(callback) {
    await this.startHttpServer()

    try {
      await callback()
    } finally {
      await this.stop()
    }
  }

  /** @returns {Promise<void>} - Resolves when complete.  */
  async startHttpServer() {
    const {configuration} = this
    const httpServerConfiguration = {
      ...configuration.httpServer,
      ...this.httpServerConfiguration
    }
    const port = httpServerConfiguration.port ?? 3006
    const host = httpServerConfiguration.host

    await this.logger.debug(`Starting server on port ${port}`)
    if (this.getType() !== "test-runner") {
      const httpServerLock = new HttpServerLock({configuration, host: host ?? "0.0.0.0", port})
      await httpServerLock.acquire()
      this.httpServerLock = httpServerLock
    }

    try {
      if (!configuration.getWebsocketEvents()) {
        configuration.setWebsocketEvents(/** @type {any} */ (websocketEventsHost))
      }

      await configuration.connectBeacon({peerType: "server"})

      this.httpServer = this.createHttpServer({
        configuration,
        host,
        inProcess: httpServerConfiguration.inProcess,
        maxWorkers: httpServerConfiguration.maxWorkers,
        port,
        workers: httpServerConfiguration.workers
      })
      this.httpServer.events.on("close", this.onHttpServerClose)
      configuration._httpServerInstance = this.httpServer

      await this.httpServer.start()
    } catch (error) {
      await this.releaseHttpServerLock()
      configuration._httpServerInstance = undefined

      throw error
    }
  }

  /**
   * @param {object} args - HTTP server arguments.
   * @param {import("./configuration.js").default} args.configuration - Configuration instance.
   * @param {string} [args.host] - Host.
   * @param {boolean} [args.inProcess] - Run HTTP handlers in the main thread.
   * @param {number} [args.maxWorkers] - Max workers.
   * @param {number} args.port - Port.
   * @param {number} [args.workers] - Worker count.
   * @returns {HttpServer} - HTTP server instance.
   */
  createHttpServer({configuration, host, inProcess, maxWorkers, port, workers}) {
    return new HttpServer({configuration, host, inProcess, maxWorkers, port, workers})
  }

  /** @returns {Promise<void>} - Resolves when complete.  */
  async stop() {
    await this.logger.debug("Stopping server")

    try {
      await this.httpServer?.stop()
      this.configuration._httpServerInstance = undefined
      await this.configuration.disconnectBeacon()
      await this.configuration.closeDatabaseConnections()
    } finally {
      await this.releaseHttpServerLock()
    }
  }

  /** @returns {Promise<void>} - Resolves after the HTTP server lock has been released. */
  async releaseHttpServerLock() {
    const {httpServerLock} = this

    this.httpServerLock = undefined
    if (httpServerLock) await httpServerLock.release()
  }

  /** @returns {void} - No return value.  */
  onHttpServerClose = () => {
    this.logger.debug("HTTP server closed")

    if (this.waitResolve) {
      this.waitResolve()
    }
  }

  /** @returns {Promise<void>} - Resolves when complete.  */
  wait() {
    return new Promise((resolve) => {
      this.waitResolve = resolve
    })
  }
}
