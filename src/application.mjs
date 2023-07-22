import {digs} from "diggerize"
import Configuration from "./configuration.mjs"
import logger from "./logger.mjs"
import HttpServer from "./http-server/index.mjs"

export default class VelociousApplication {
  constructor({debug, directory, httpServer}) {
    this.configuration = new Configuration({debug, directory})
    this.httpServerConfiguration = httpServer ?? {}
  }

  async initialize() {
    if (global.velociousApplication) throw new Error("A Velocious application is already running")
    if (global.velociousConfiguration) throw new Error("A Velocious configuration has already been set")

    global.velociousApplication = this
    global.velociousConfiguration = this.configuration

    await this.configuration.initialize()
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

    global.velociousApplication = undefined
    global.velociousConfiguration = undefined
  }
}
