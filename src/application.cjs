const {digs} = require("@kaspernj/object-digger")
const HttpServer = require("./http-server/index.cjs")

module.exports = class VelociousApplication {
  constructor({debug, directory, httpServer}) {
    this.debug = debug ?? false
    this.directory = directory
    this.httpServerConfiguration = httpServer ?? {}
    this.routes = require(`${directory}/config/routes.cjs`)
  }

  async start() {
    const {debug, httpServerConfiguration} = digs(this, "debug", "httpServerConfiguration")
    const port = httpServerConfiguration.port || 3006
    const httpServer = new HttpServer({debug, port})

    await httpServer.start()
  }
}
