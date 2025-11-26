import {dirname} from "path"
import {fileURLToPath} from "url"
import fs from "fs/promises"

import configurationResolver from "../configuration-resolver.js"
import fileExists from "../utils/file-exists.js"

export default class VelociousCli {
  constructor(args = {}) {
    this.args = args
  }

  async execute() {
    const commandParts = this.args.processArgs[0].split(":")
    const filePaths = []
    const basePath = await this.getBasePath()
    const commandsPath = `${basePath}/src/cli/commands`
    let filePath = commandsPath

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
      const possibleCommands = []
      const commandFiles = fs.glob(`${commandsPath}/**/*.js`)

      for await (const aFilePath of commandFiles) {
        const aFilePathParts = aFilePath.split("/")
        const lastPart = aFilePathParts[aFilePathParts.length - 1]

        if (lastPart == "index.js") {
          possibleCommands.push(aFilePathParts[aFilePathParts.length - 2])
        } else {
          possibleCommands.push(lastPart.replace(".js", ""))
        }
      }

      throw new Error(`Unknown command: ${this.args.processArgs[0]} which should have been one of: ${possibleCommands.sort().join(", ")}`)
    }

    const commandClassImport = await import(fileFound)
    const CommandClass = commandClassImport.default

    await this.loadConfiguration()

    const commandInstance = new CommandClass(this.args)

    if (commandInstance.initialize) {
      await commandInstance.initialize()
    }

    return await commandInstance.execute()
  }

  async getBasePath() {
    const __filename = fileURLToPath(import.meta.url)
    const basePath = await fs.realpath(`${dirname(__filename)}/../..`)

    return basePath
  }

  async loadConfiguration() {
    this.configuration = await configurationResolver({directory: this.args.directory})
    this.configuration.setCurrent()
    this.args.configuration = this.configuration
  }

  getConfiguration() { return this.args.configuration }
}
