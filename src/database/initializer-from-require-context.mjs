export default class VelociousDatabaseInitializerFromRequireContext {
  constructor(requireContext) {
    this.requireContext = requireContext
  }

  async initialize() {
    for (const fileName of this.requireContext.keys()) {
      const modelClass = this.requireContext(fileName).default

      await modelClass.initializeRecord()

      if (await modelClass.hasTranslationsTable()) {
        await modelClass.getTranslationClass().initializeRecord()
      }
    }
  }
}
