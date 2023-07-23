import {dirname} from "path"
import {fileURLToPath} from "url"
import fileExists from "../utils/file-exists.mjs"

export default class VelociousCli {
  async execute(args) {
    const processArgs = args.processArgs
    const __filename = fileURLToPath(`${import.meta.url}/../..`)
    const __dirname = dirname(__filename)
    const commandParts = processArgs[0].split(":")
    let filePath = `${__dirname}/src/cli/commands`

    for (let commandPart of commandParts) {
      if (commandPart == "d") commandPart = "destroy"
      if (commandPart == "g") commandPart = "generate"

      filePath += `/${commandPart}`
    }

    filePath += ".mjs"

    if (!fileExists(filePath)) throw new Error(`Unknown command: ${processArgs[0]} which should have been in ${filePath}`)

    const commandClassImport = await import(filePath)
    const CommandClass = commandClassImport.default
    const commandInstance = new CommandClass(args)

    if (commandInstance.initialize) {
      await commandInstance.initialize()
    }

    return await commandInstance.execute()
  }
}
