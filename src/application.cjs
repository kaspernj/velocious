const {digs} = require("diggerize")
const Configuration = require("./configuration.cjs")
const logger = require("./logger.cjs")
const HttpServer = require("./http-server/index.cjs")

module.exports = class VelociousApplication {
  constructor({debug, directory, httpServer}) {
    this.configuration = new Configuration({debug, directory})
    this.httpServerConfiguration = httpServer ?? {}
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

  async start() {
    const {configuration, httpServerConfiguration} = digs(this, "configuration", "httpServerConfiguration")
    const port = httpServerConfiguration.port || 3006

    logger(this, `Starting server on port ${port}`)

    if (global.velociousApplication) throw new Error("A Velocious application is already running")
    if (global.velociousConfiguration) throw new Error("A Velocious configuration has already been set")

    this.httpServer = new HttpServer({configuration, port})

    await this.httpServer.start()

    global.velociousApplication = this
    global.velociousConfiguration = this.configuration
  }

  async stop() {
    logger(this, "Stopping server")

    await this.httpServer.stop()

    global.velociousApplication = undefined
    global.velociousConfiguration = undefined
  }
}
