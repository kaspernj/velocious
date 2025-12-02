import Application from "../../../../application.js"
import BaseCommand from "../../../../cli/base-command.js"

export default class VelociousCliCommandsServer extends BaseCommand{
  async execute() {
    this.databasePool = this.getConfiguration().getDatabasePool()
    this.newConfiguration = Object.assign({}, this.databasePool.getConfiguration())
    this.databaseConnection = await this.databasePool.spawnConnectionWithConfiguration(this.newConfiguration)

    await this.databaseConnection.connect()

    const {parsedProcessArgs} = this.args
    const host = parsedProcessArgs.h || parsedProcessArgs.host || "127.0.0.1"
    const port = parsedProcessArgs.p || parsedProcessArgs.port || 3006
    const application = new Application({
      configuration: this.getConfiguration(),
      httpServer: {
        host,
        port
      },
      type: "server"
    })
    const environment = this.getConfiguration().getEnvironment()

    await application.initialize()
    await application.startHttpServer()
    console.log(`Started Velocious HTTP server on ${host}:${port} in ${environment} environment`)
    await application.wait()
  }
}
