export default class VelociousDatabaseInitializerFromRequireContext {
  constructor({requireContext, ...restProps}) {
    const restPropsKeys = Object.keys(restProps)

    if (restPropsKeys.length > 0) throw new Error(`Unknown arguments: ${restPropsKeys.join(", ")}`)

    this.requireContext = requireContext
  }

  async initialize({configuration}) {
    for (const fileName of this.requireContext.keys()) {
      const modelClass = this.requireContext(fileName).default

      await modelClass.initializeRecord({configuration})

      if (await modelClass.hasTranslationsTable()) {
        await modelClass.getTranslationClass().initializeRecord({configuration})
      }
    }
  }
}
