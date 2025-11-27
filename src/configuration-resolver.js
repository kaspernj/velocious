import Configuration from "./configuration.js"
import envSense from "env-sense/src/use-env-sense.js"
import fileExists from "./utils/file-exists.js"

const configurationResolver = async (args = {}) => {
  if (Configuration.current(false)) {
    return Configuration.current()
  }

  const directory = args.directory || process.cwd()
  let configurationPrePath = `${directory}/src/config/configuration`
  const configurationPathForNode = `${configurationPrePath}.node.js`
  const configurationPathDefault = `${configurationPrePath}.js`
  const {isServer} = envSense()
  let configuration, configurationPath

  if (isServer && await fileExists(configurationPathForNode)) {
    configurationPath = configurationPathForNode
  } else {
    configurationPath = configurationPathDefault
  }

  try {
    const configurationImport = await import(configurationPath)

    configuration = configurationImport.default
  } catch (error) {
    // This might happen during an "init" CLI command where we copy a sample configuration file.
    if (!error.message.match(/^Cannot find module '(.+)\/configuration\.js'/)) {
      throw error
    }

    configuration = new Configuration(args)
  }

  return configuration
}

export default configurationResolver
