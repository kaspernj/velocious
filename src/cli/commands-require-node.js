import fileExists from "../utils/file-exists.js"
import restArgsError from "../utils/rest-args-error.js"

/**
 * @param {Array<{name: string, file: string}>} commands
 * @param {Array<string>} commandParts
 * @template T extends import ("./base-command.js").default
 * @returns {Promise<T>}
*/
export default async function commandsRequireNode({commands, commandParts, ...restArgs}) {
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
