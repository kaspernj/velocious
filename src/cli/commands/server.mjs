import BaseCommand from "../base-command.mjs"

export default class DbCreate extends BaseCommand{
  async execute() {
    this.databasePool = this.configuration.getDatabasePool()
    this.newConfiguration = Object.assign({}, this.databasePool.getConfiguration())

    if (this.args.testing) this.result = []

    this.databaseConnection = await this.databasePool.spawnConnectionWithConfiguration(this.newConfiguration)
    await this.databaseConnection.connect()

    throw new Error("stub")
  }
}
