import configurationResolver from "../configuration-resolver.mjs"
import {dirname} from "path"
import {fileURLToPath} from "url"
import fileExists from "../utils/file-exists.mjs"

export default class VelociousCli {
  constructor(args = {}) {
    this.args = args
  }

  async execute() {
    const __filename = fileURLToPath(`${import.meta.url}/../..`)
    const __dirname = dirname(__filename)
    const commandParts = this.args.processArgs[0].split(":")
    let filePath = `${__dirname}/src/cli/commands`

    for (let commandPart of commandParts) {
      if (commandPart == "d") commandPart = "destroy"
      if (commandPart == "g") commandPart = "generate"

      filePath += `/${commandPart}`
    }

    filePath += ".mjs"

    if (!await fileExists(filePath)) throw new Error(`Unknown command: ${this.args.processArgs[0]} which should have been in ${filePath}`)

    const commandClassImport = await import(filePath)
    const CommandClass = commandClassImport.default

    await this.loadConfiguration()

    const commandInstance = new CommandClass(this.args)

    if (commandInstance.initialize) {
      await commandInstance.initialize()
    }

    return await commandInstance.execute()
  }

  async loadConfiguration() {
    this.configuration = await configurationResolver({directory: this.args.directory})
    this.configuration.setCurrent()
    this.args.configuration = this.configuration
  }
}
