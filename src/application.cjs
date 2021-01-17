const HttpServer = require("./http-server/index.cjs")

module.exports = class VelociousApplication {
  constructor({directory, httpServer}) {
    this.directory = directory
    this.httpServerConfiguration = httpServer
    this.routes = require(`${directory}/config/routes.cjs`)
  }

  async start() {
    const httpServerConfiguration = this.httpServerConfiguration || {}
    const port = httpServerConfiguration.port || 3006
    const httpServer = new HttpServer({port})

    await httpServer.start()
  }
}
