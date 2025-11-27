import restArgsError from "../../utils/rest-args-error"
import { digg } from "diggerize"

/**
 * @returns {Promise<Array<{name: string, file: string}>>}
 */
export default async function migrationsFinderBrowser({args, configuration, ...restArgs}) {
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
