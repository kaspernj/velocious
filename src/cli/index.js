// @ts-check

export default class VelociousCli {
  /**
   * @param {object} args - Options object.
   * @param {import("../configuration.js").default} [args.configuration] - Configuration instance.
   * @param {string} [args.directory] - Directory path.
   * @param {import("../environment-handlers/base.js").default} [args.environmentHandler] - Environment handler.
   * @param {Record<string, any>} [args.parsedProcessArgs] - Parsed process args.
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

  async execute() {
    const commandParts = this.args.processArgs[0].split(":")
    const parsedCommandParts = []

    for (let commandPart of commandParts) {
      if (commandPart == "d") commandPart = "destroy"
      if (commandPart == "g") commandPart = "generate"
      if (commandPart == "s") commandPart = "server"

      parsedCommandParts.push(commandPart)
    }

    const CommandClass = await this.environmentHandler.requireCommand({commandParts: parsedCommandParts})
    const commandInstance = new CommandClass({args: this.args, cli: this})

    await commandInstance.initialize()

    return await commandInstance.execute()
  }

  /** @returns {import("../configuration.js").default} configuration */
  getConfiguration() { return this.configuration }

  /** @returns {boolean} - Whether testing.  */
  getTesting() {
    return this.args.testing
  }
}
