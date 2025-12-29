// @ts-check

import fs from "fs/promises"
import path from "path"

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

  async execute() {
    if (!this.args.processArgs || this.args.processArgs.length === 0) {
      throw new Error("No command given")
    }

    const commandParts = this.args.processArgs[0].split(":")
    let parsedCommandParts = []

    for (let commandPart of commandParts) {
      if (commandPart == "d") commandPart = "destroy"
      if (commandPart == "g") commandPart = "generate"
      if (commandPart == "s") commandPart = "server"

      parsedCommandParts.push(commandPart)
    }

    const commands = await this.environmentHandler.findCommands()
    const commandNames = new Set(commands.map(aCommand => aCommand.name))
    const commandKey = parsedCommandParts.join(":")

    if (!commandNames.has(commandKey) && await this.isPathArgument(this.args.processArgs[0])) {
      this.args.processArgs = ["test", ...this.args.processArgs]
      parsedCommandParts = ["test"]
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

  /**
   * @param {string} arg - CLI argument to evaluate.
   * @returns {Promise<boolean>} - Whether the argument resolves to a file or directory.
   */
  async isPathArgument(arg) {
    const baseDirectory = this.getConfiguration().getDirectory()
    const fullPath = path.isAbsolute(arg) ? arg : path.resolve(baseDirectory, arg)

    try {
      const stat = await fs.stat(fullPath)
      return stat.isFile() || stat.isDirectory()
    } catch {
      return false
    }
  }
}
