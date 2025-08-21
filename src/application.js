import AppRoutes from "../src/routes/app-routes.js"
import {digs} from "diggerize"
import logger from "./logger.js"
import HttpServer from "./http-server/index.js"

export default class VelociousApplication {
  constructor({configuration, httpServer}) {
    this.configuration = configuration
    this.httpServerConfiguration = httpServer ?? {}
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

    logger(this, `Starting server on port ${port}`)

    this.httpServer = new HttpServer({configuration, port})
    this.httpServer.events.on("close", this.onHttpServerClose)

    await this.httpServer.start()
  }

  async stop() {
    logger(this, "Stopping server")

    await this.httpServer.stop()
  }

  onHttpServerClose = () => {
    logger(this, "HTTP server closed")

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
