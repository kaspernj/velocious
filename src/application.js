// @ts-check

import AppRoutes from "./routes/app-routes.js"
import Logger from "./logger.js"
import HttpServer from "./http-server/index.js"
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

    await this.logger.debug(`Starting server on port ${port}`)

    if (!configuration.getWebsocketEvents()) {
      configuration.setWebsocketEvents(/** @type {any} */ (websocketEventsHost))
    }

    await configuration.connectBeacon({peerType: "server"})

    this.httpServer = new HttpServer({
      configuration,
      host: httpServerConfiguration.host,
      inProcess: httpServerConfiguration.inProcess,
      maxWorkers: httpServerConfiguration.maxWorkers,
      port,
      workers: httpServerConfiguration.workers
    })
    this.httpServer.events.on("close", this.onHttpServerClose)
    configuration._httpServerInstance = this.httpServer

    await this.httpServer.start()
  }

  /** @returns {Promise<void>} - Resolves when complete.  */
  async stop() {
    await this.logger.debug("Stopping server")
    await this.httpServer?.stop()
    this.configuration._httpServerInstance = undefined
    await this.configuration.disconnectBeacon()
    await this.configuration.closeDatabaseConnections()
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
