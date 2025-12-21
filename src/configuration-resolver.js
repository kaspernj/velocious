// @ts-check

import Configuration, {CurrentConfigurationNotSetError} from "./configuration.js"
import envSense from "env-sense/build/use-env-sense.js"
import fileExists from "./utils/file-exists.js"

/**
 * @param {import("./configuration-types.js").ConfigurationArgsType} [args]
 * @returns {Promise<Configuration>}
 */
export default async function configurationResolver(args) {
  let configuration

  try {
    configuration = Configuration.current()
  } catch (error) {
    if (error instanceof CurrentConfigurationNotSetError) {
      // Ignore
    } else {
      throw error
    }
  }

  if (configuration) {
    return Configuration.current()
  }

  const directory = args?.directory || process.cwd()
  let configurationPrePath = `${directory}/src/config/configuration`
  const configurationPathForNode = `${configurationPrePath}.node.js`
  const configurationPathDefault = `${configurationPrePath}.js`
  const {isServer} = envSense()
  let configurationPath

  if (isServer && await fileExists(configurationPathForNode)) {
    configurationPath = configurationPathForNode
  } else {
    configurationPath = configurationPathDefault
  }

  try {
    const configurationImport = await import(configurationPath)

    configuration = configurationImport.default
  } catch (error) {
    console.log(`Couldn't load configuration from ${configurationPath} because of: ${error instanceof Error ? error.message : error}`)

    if (error instanceof Error) {
      // This might happen during an "init" CLI command where we copy a sample configuration file.
      if (!error.message.match(/^Cannot find module '(.+)\/configuration\.js'/)) {
        throw error
      }
    }

    if (!args) {
      throw new Error("Can't spawn a new configuration because no configuration-arguments was given")
    }

    configuration = new Configuration(args)
  }

  return configuration
}
