import fs from "fs/promises"

/**
 * @returns {Promise<Array<{name: string, file: string}>>}
 */
export default async function commandsFinderNode() {
  const commandFiles = fs.glob(`${commandsPath}/**/*.js`)
  const commands = []

  for await (const aFilePath of commandFiles) {
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
