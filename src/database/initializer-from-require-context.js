export default class VelociousDatabaseInitializerFromRequireContext {
  constructor({requireContext, ...restProps}) {
    const restPropsKeys = Object.keys(restProps)

    if (restPropsKeys.length > 0) throw new Error(`Unknown arguments: ${restPropsKeys.join(", ")}`)

    this.requireContext = requireContext
  }

  async initialize({configuration}) {
    for (const fileName of this.requireContext.keys()) {
      const modelClassImport = this.requireContext(fileName)

      if (!modelClassImport) throw new Error(`Couldn't import model class from ${fileName}`)

      const modelClass = modelClassImport.default

      await modelClass.initializeRecord({configuration})

      if (await modelClass.hasTranslationsTable()) {
        const translationClass = modelClass.getTranslationClass()

        await translationClass.initializeRecord({configuration})
      }
    }
  }
}
