const {digs} = require("@kaspernj/object-digger")
const Configuration = require("./configuration.cjs")
const logger = require("./logger.cjs")
const HttpServer = require("./http-server/index.cjs")

module.exports = class VelociousApplication {
  constructor({debug, directory, httpServer}) {
    this.configuration = new Configuration({debug, directory})
    this.httpServerConfiguration = httpServer ?? {}
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
