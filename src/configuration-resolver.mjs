import Configuration from "./configuration.mjs"

const configurationResolver = async (args) => {
  if (Configuration.current(false)) {
    return Configuration.current()
  }

  const directory = args.directory || process.cwd()
  const configurationPath = `${directory}/src/config/configuration.mjs`
  let configuration

  try {
    const configurationImport = await import(configurationPath)

    configuration = configurationImport.default
  } catch (error) {
    // This might happen during an "init" CLI command where we copy a sample configuration file.
    if (error.code != "ERR_MODULE_NOT_FOUND") throw error

    configuration = new Configuration(args)
  }

  return configuration
}

export default configurationResolver
