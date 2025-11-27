/**
 * @returns {Promise<Array<{name: string, file: string}>>}
 */
export default function commandsFinderBrowser() {
  const commandFiles = require.context("./commands", true, /\.js$/)
  const commands = []

  for (const aFilePath of commandFiles.keys()) {
    console.log({aFilePath})

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
