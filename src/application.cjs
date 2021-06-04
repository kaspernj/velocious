const {digs} = require("@kaspernj/object-digger")
const logger = require("./logger.cjs")
const HttpServer = require("./http-server/index.cjs")
const Routes = require("./routes.cjs")

module.exports = class VelociousApplication {
  constructor({debug, directory, httpServer}) {
    this.debug = debug ?? false
    this.directory = directory
    this.httpServerConfiguration = httpServer ?? {}
    this._routes = new Routes()
  }

  routes() {
    return this._routes
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
    const {debug, httpServerConfiguration} = digs(this, "debug", "httpServerConfiguration")
    const port = httpServerConfiguration.port || 3006

    logger(this, `Starting server on port ${port}`)

    this.httpServer = new HttpServer({debug, port})

    await this.httpServer.start()
  }

  stop() {
    this.httpServer.stop()
  }
}
