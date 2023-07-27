import DatabasePool from "./database/pool/index.mjs"
import {digs} from "diggerize"
import logger from "./logger.mjs"
import HttpServer from "./http-server/index.mjs"

export default class VelociousApplication {
  constructor({configuration, httpServer}) {
    this.configuration = configuration
    this.httpServerConfiguration = httpServer ?? {}
  }

  async initialize() {
    await this.configuration.initialize()
    await this.initializeDatabasePool()
  }

  async initializeDatabasePool() {
    this.databasePool = new DatabasePool({configuration: this.configuration})
    this.databasePool.setCurrent()

    if (!this.databasePool.isConnected()) {
      await this.databasePool.connect()
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

    await this.httpServer.start()
  }

  async stop() {
    logger(this, "Stopping server")

    await this.httpServer.stop()
  }
}
