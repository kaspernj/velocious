import {dirname} from "path"
import {fileURLToPath} from "url"
import fs from "fs/promises"

async function getBasePath() {
  const __filename = fileURLToPath(import.meta.url)
  const basePath = await fs.realpath(dirname(__filename))

  return basePath
}

/**
 * @returns {Promise<Array<{name: string, file: string}>>}
 */
export default async function commandsFinderNode() {
  const basePath = await getBasePath()
  const commandFiles = fs.glob(`${basePath}/commands/**/*.js`)
  const commands = []

  for await (const aFilePath of commandFiles) {
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

    commands.push({name: commandName, file: aFilePath})
  }

  return commands
}
