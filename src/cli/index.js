export default class VelociousCli {
  constructor(args = {}) {
    if (!args.configuration) throw new Error("configuration argument is required")

    this.args = args
    this.configuration = args.configuration
    this.environmentHandler = new args.environmentHandler({args: this.args, configuration: args.configuration})
  }

  async execute() {
    const commandParts = this.args.processArgs[0].split(":")
    const parsedCommandParts = []

    for (let commandPart of commandParts) {
      if (commandPart == "d") commandPart = "destroy"
      if (commandPart == "g") commandPart = "generate"
      if (commandPart == "s") commandPart = "server"

      parsedCommandParts.push(commandPart)
    }

    const CommandClass = await this.environmentHandler.requireCommand({commandParts})
    const commandInstance = new CommandClass({args: this.args, environmentHandler: this.environmentHandler})

    if (commandInstance.initialize) {
      await commandInstance.initialize()
    }

    return await commandInstance.execute()
  }

  getConfiguration() { return this.configuration }
}
