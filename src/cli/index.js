// @ts-check

export default class VelociousCli {
  /**
   * @param {object} args - Options object.
   * @param {import("../configuration.js").default} [args.configuration] - Configuration instance.
   * @param {string} [args.directory] - Directory path.
   * @param {import("../environment-handlers/base.js").default} [args.environmentHandler] - Environment handler.
   * @param {Record<string, string | number | boolean | undefined>} [args.parsedProcessArgs] - Parsed process args.
   * @param {string[]} [args.processArgs] - Process args.
   * @param {boolean} [args.testing] - Whether testing.
   */
  constructor(args = {}) {
    if (!args.configuration) throw new Error("configuration argument is required")

    this.args = args
    this.configuration = args.configuration

    this.environmentHandler = args.configuration.getEnvironmentHandler()
    this.environmentHandler.setArgs(args)
    this.environmentHandler.setConfiguration(args.configuration)
  }

  /**
   * @returns {Promise<unknown>} - Resolves with the final command result.
   */
  async execute() {
    const commandGroups = await this.commandGroups()
    let result

    for (const [index, commandProcessArgs] of commandGroups.entries()) {
      if (index > 0) {
        await this.getConfiguration().closeDatabaseConnections()
      }

      result = await this.executeCommand(commandProcessArgs)
    }

    return result
  }

  /**
   * @param {string[]} processArgs - Process args for a single command.
   * @returns {Promise<unknown>} - Resolves with the command result.
   */
  async executeCommand(processArgs) {
    if (!processArgs[0]) {
      throw new Error("Missing command argument")
    }

    const commandParts = processArgs[0].split(":")
    const parsedCommandParts = []

    for (let commandPart of commandParts) {
      if (commandPart == "c") commandPart = "console"
      if (commandPart == "d") commandPart = "destroy"
      if (commandPart == "g") commandPart = "generate"
      if (commandPart == "s") commandPart = "server"

      parsedCommandParts.push(commandPart)
    }

    const CommandClass = await this.environmentHandler.requireCommand({commandParts: parsedCommandParts})
    const commandInstance = new CommandClass({
      args: Object.assign({}, this.args, {processArgs}),
      cli: this
    })

    await commandInstance.initialize()

    return await commandInstance.execute()
  }

  /**
   * @returns {Promise<string[][]>} - Command groups with process args for each command.
   */
  async commandGroups() {
    const processArgs = this.args.processArgs || []
    const commands = await this.environmentHandler.findCommands()
    const commandNames = new Set(commands.map((command) => command.name))
    /** @type {string[][]} */
    const groups = []
    /** @type {string[]} */
    let currentGroup = []

    for (const processArg of processArgs) {
      if (currentGroup.length == 0) {
        if (processArg.startsWith("-")) continue

        currentGroup = [processArg]
        continue
      }

      if (!processArg.startsWith("-") && commandNames.has(processArg)) {
        groups.push(currentGroup)
        currentGroup = [processArg]
      } else {
        currentGroup.push(processArg)
      }
    }

    if (currentGroup.length > 0) {
      groups.push(currentGroup)
    }

    if (groups.length == 0) {
      throw new Error("Missing command argument")
    }

    return groups
  }

  /** @returns {import("../configuration.js").default} configuration */
  getConfiguration() { return this.configuration }

  /** @returns {boolean} - Whether testing.  */
  getTesting() {
    return this.args.testing || false
  }
}
