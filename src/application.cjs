const {digs} = require("diggerize")
const Configuration = require("./configuration.cjs")
const logger = require("./logger.cjs")
const HttpServer = require("./http-server/index.cjs")

module.exports = class VelociousApplication {
  constructor({debug, directory, httpServer}) {
    if (global.velociousApplication) throw new Error("A Velocious application is already running")
    if (global.velociousConfiguration) throw new Error("A Velocious configuration has already been set")

    this.configuration = new Configuration({debug, directory})
    this.httpServerConfiguration = httpServer ?? {}

    global.velociousApplication = this
    global.velociousConfiguration = this.configuration
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

    this.httpServer = new HttpServer({configuration, port})

    await this.httpServer.start()
  }

  stop() {
    this.httpServer.stop()
  }
}
