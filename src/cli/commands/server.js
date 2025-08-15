import Application from "../../application.js"
import BaseCommand from "../base-command.js"

export default class VelociousCliCommandsServer extends BaseCommand{
  async execute() {
    this.databasePool = this.configuration.getDatabasePool()
    this.newConfiguration = Object.assign({}, this.databasePool.getConfiguration())
    this.databaseConnection = await this.databasePool.spawnConnectionWithConfiguration(this.newConfiguration)

    await this.databaseConnection.connect()

    const host = "0.0.0.0"
    const port = 3006
    const application = new Application({
      configuration: this.configuration,
      httpServer: {
        host,
        port
      }
    })

    await application.initialize()
    await application.startHttpServer()
    console.log(`Started Velocious HTTP server on ${host}:${port}`)
    await application.wait()
  }
}
