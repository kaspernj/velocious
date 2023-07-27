const configurationResolver = async (args) => {
  if (global.velociousConfiguration) {
    return global.velociousConfiguration
  }

  const directory = args.directory || process.cwd()
  const configurationPath = `${directory}/src/config/configuration.mjs`
  const configurationImport = await import(configurationPath)
  const configuration = configurationImport.default

  return configuration
}

export default configurationResolver
