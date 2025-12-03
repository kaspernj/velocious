import AppRoutes from "../src/routes/app-routes.js"
import {digs} from "diggerize"
import {Logger} from "./logger.js"
import HttpServer from "./http-server/index.js"

export default class VelociousApplication {
  /**
   * @param {object} args
   * @param {import("./http-server/index.js").default} args.httpServer
   * @param {import("./configuration.js").default} args.configuration
   * @param {string} args.type
   */
  constructor({configuration, httpServer, type}) {
    this.configuration = configuration
    this.httpServerConfiguration = httpServer ?? {}
    this.logger = new Logger(this)
    this._type = type
  }

  /**
   * @returns {string}
   */
  getType() { return this._type }

  /**
   * @returns {Promise<void>}
   */
  async initialize() {
    const routes = await AppRoutes.getRoutes(this.configuration)

    await this.configuration.initialize({type: this.getType()})

    this.configuration.setRoutes(routes)

    if (!this.configuration.isDatabasePoolInitialized()) {
      await this.configuration.initializeDatabasePool()
    }
  }

  /**
   * @returns {boolean}
   */
  isActive() {
    return this.httpServer?.isActive()
  }

  /**
   * @param {function() : void} callback
   * @returns {Promise<void>}
   */
  async run(callback) {
    await this.start()

    try {
      await callback()
    } finally {
      this.stop()
    }
  }

  /**
   * @returns {Promise<void>}
   */
  async startHttpServer() {
    const {configuration, httpServerConfiguration} = digs(this, "configuration", "httpServerConfiguration")
    const port = httpServerConfiguration.port || 3006

    await this.logger.debug(`Starting server on port ${port}`)

    this.httpServer = new HttpServer({configuration, port})
    this.httpServer.events.on("close", this.onHttpServerClose)

    await this.httpServer.start()
  }

  /**
   * @returns {Promise<void>}
   */
  async stop() {
    await this.logger.debug("Stopping server")
    await this.httpServer.stop()
  }

  /**
   * @returns {void}
   */
  onHttpServerClose = () => {
    this.logger.debug("HTTP server closed")

    if (this.waitResolve) {
      this.waitResolve()
    }
  }

  /**
   * @returns {Promise<void>}
   */
  wait() {
    return new Promise((resolve) => {
      this.waitResolve = resolve
    })
  }
}
