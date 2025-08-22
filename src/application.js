import AppRoutes from "../src/routes/app-routes.js"
import {digs} from "diggerize"
import {Logger} from "./logger.js"
import HttpServer from "./http-server/index.js"

export default class VelociousApplication {
  constructor({configuration, httpServer}) {
    this.configuration = configuration
    this.httpServerConfiguration = httpServer ?? {}
    this.logger = new Logger(this)
  }

  async initialize() {
    const routes = await AppRoutes.getRoutes(this.configuration)

    await this.configuration.initialize()

    this.configuration.setRoutes(routes)

    if (!this.configuration.isDatabasePoolInitialized()) {
      await this.configuration.initializeDatabasePool()
    }
  }

  isActive() {
    return this.httpServer?.isActive()
  }

  async run(callback) {
    await this.start()

    try {
      await callback()
    } finally {
      this.stop()
    }
  }

  async startHttpServer() {
    const {configuration, httpServerConfiguration} = digs(this, "configuration", "httpServerConfiguration")

    const port = httpServerConfiguration.port || 3006

    await this.logger.debug(`Starting server on port ${port}`)

    this.httpServer = new HttpServer({configuration, port})
    this.httpServer.events.on("close", this.onHttpServerClose)

    await this.httpServer.start()
  }

  async stop() {
    await this.logger.debug("Stopping server")
    await this.httpServer.stop()
  }

  onHttpServerClose = () => {
    this.logger.debug("HTTP server closed")

    if (this.waitResolve) {
      this.waitResolve()
    }
  }

  wait() {
    return new Promise((resolve) => {
      this.waitResolve = resolve
    })
  }
}
