const configurationResolver = () => {
  const directory = process.cwd()
  const configurationPath = `${directory}/src/config/configuration.mjs`
  const configurationImport = await import(configurationPath)
  const configuration = configurationImport.default

  return configuration
}

export default configurationResolver
