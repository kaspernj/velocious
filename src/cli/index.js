export default class VelociousCli {
  constructor(args = {}) {
    const {commands, configuration, requireCommand, ...restArgs} = args

    if (!commands) throw new Error("commands argument is required")
    if (!configuration) throw new Error("configuration argument is required")
    if (!requireCommand) throw new Error("requireCommand argument is required")

    this.args = restArgs
    this.args.configuration = configuration

    this.commands = commands
    this.requireCommand = requireCommand
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

    const CommandClass = await this.requireCommand({commands: this.commands, commandParts: parsedCommandParts})
    const commandInstance = new CommandClass(this.args)

    if (commandInstance.initialize) {
      await commandInstance.initialize()
    }

    return await commandInstance.execute()
  }
}
