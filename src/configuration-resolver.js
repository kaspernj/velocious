import Configuration from "./configuration.js"

const configurationResolver = async (args) => {
  if (Configuration.current(false)) {
    return Configuration.current()
  }

  const directory = args.directory || process.cwd()
  const configurationPath = `${directory}/src/config/configuration.js`
  let configuration

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
