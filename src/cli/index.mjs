import {dirname} from "path"
import {fileURLToPath} from "url"
import fs from "node:fs/promises"

const fileExists = async (path) => {
  try {
    await fs.access(path)

    return true
  } catch (error) {
    return false
  }
}

export default class VelociousCli {
  async execute({args}) {
    const __filename = fileURLToPath(`${import.meta.url}/../..`)
    const __dirname = dirname(__filename)
    const commandParts = args[0].split(":")
    let filePath = `${__dirname}/src/cli/commands`

    for (let commandPart of commandParts) {
      if (commandPart == "d") commandPart = "destroy"
      if (commandPart == "g") commandPart = "generate"

      filePath += `/${commandPart}`
    }

    filePath += ".mjs"

    if (!fileExists(filePath)) throw new Error(`Unknown command: ${args[0]} which should have been in ${filePath}`)

    const commandClassImport = await import(filePath)
    const CommandClass = commandClassImport.default
    const commandInstance = new CommandClass({args})

    if (commandInstance.initialize) {
      await commandInstance.initialize()
    }

    await commandInstance.execute()
  }
}
