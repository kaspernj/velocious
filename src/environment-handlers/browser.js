import {digg} from "diggerize"
import fileExists from "../utils/file-exists.js"
import restArgsError from "../utils/rest-args-error.js"

export default class VelociousEnvironmentsHandlerBrowser {
  constructor({args, cli, configuration, processArgs, ...restArgs}) {
    this.args = args
    this.configuration = configuration
    this.processArgs = processArgs

    restArgsError(restArgs)
  }

  /**
   * @returns {Promise<Array<{name: string, file: string}>>}
   */
  findCommands() {
    const commandFiles = require.context("./commands", true, /\.js$/)
    const commands = []

    for (const aFilePath of commandFiles.keys()) {
      const aFilePathParts = aFilePath.split("/")
      const lastPart = aFilePathParts[aFilePathParts.length - 1]
      let name

      if (lastPart == "index.js") {
        name = aFilePathParts[aFilePathParts.length - 2]
      } else {
        name = lastPart.replace(".js", "")
      }

      commands.push({name, file: aFilePath})
    }

    return commands
  }

  /**
   * @param {Array<{name: string, file: string}>} commands
   * @param {Array<string>} commandParts
   * @template T extends import ("./base-command.js").default
   * @returns {Promise<T>}
  */
  async requireCommand({commands, commandParts, ...restArgs}) {
    restArgsError(restArgs)

    let filePath = ""

    for (let commandPart of commandParts) {
      if (commandPart == "d") commandPart = "destroy"
      if (commandPart == "g") commandPart = "generate"
      if (commandPart == "s") commandPart = "server"

      filePath += `/${commandPart}`
    }

    filePaths.push(`${filePath}/index.js`)
    filePath += ".js"
    filePaths.push(filePath)

    let fileFound

    for (const aFilePath of filePaths) {
      if (await fileExists(aFilePath)) {
        fileFound = aFilePath
        break
      }
    }

    if (!fileFound) {
      throw new Error(`Unknown command: ${this.args.processArgs[0]} which should have been one of: ${possibleCommands.sort().join(", ")}`)
    }

    const commandClassImport = await import(fileFound)
    const CommandClass = commandClassImport.default

    return CommandClass
  }

  /**
   * @returns {Promise<Array<{name: string, file: string}>>}
   */
  async findMigrations({args, configuration, ...restArgs}) {
    restArgsError(restArgs)

    const migrationsRequireContextCallback = digg(args, "migrationsRequireContextCallback")

    if (!migrationsRequireContextCallback) throw new Error("migrationsRequireContextCallback is required")

    const migrationsRequireContext = await migrationsRequireContextCallback()
    const migrations = []

    for await (const aFilePath of migrationsRequireContext.keys()) {
      const aFilePathParts = aFilePath.split("/")
      const commandPathLocation = aFilePathParts.indexOf("commands") + 1
      const lastPart = aFilePathParts[aFilePathParts.length - 1]
      let name, paths

      if (lastPart == "index.js") {
        name = aFilePathParts[aFilePathParts.length - 2]
        paths = aFilePathParts.slice(commandPathLocation, -2)
      } else {
        name = lastPart.replace(".js", "")
        paths = aFilePathParts.slice(commandPathLocation, -1)
      }

      const commandName = `${paths.join(":")}${paths.length > 0 ? ":" : ""}${name}`

      migrations.push({name: commandName, file: aFilePath})
    }

    return migrations
  }

  /**
   * @param {Array<{name: string, file: string}>} commands
   * @param {Array<string>} commandParts
   * @template T extends import ("../migration/index.js").default
   * @returns {Promise<T>}
  */
  async requireMigration() {
    restArgsError(restArgs)

    const command = commands.find((aCommand) => aCommand.name === commandParts.join(":"))

    if (!command) {
      const possibleCommands = commands.map(aCommand => aCommand.name)

      throw new Error(`Unknown command: ${processArgs[0]} which should have been one of: ${possibleCommands.sort().join(", ")}`)
    }

    const commandClassImport = await import(command.file)
    const CommandClass = commandClassImport.default

    return CommandClass
  }
}
