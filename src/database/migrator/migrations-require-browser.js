import restArgsError from "../utils/rest-args-error.js"

/**
 * @param {Array<{name: string, file: string}>} commands
 * @param {Array<string>} commandParts
 * @template T extends import ("../migration/index.js").default
 * @returns {Promise<T>}
*/
export default async function migrationsRequireBrowser({configuration, processArgs, ...restArgs}) {
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
