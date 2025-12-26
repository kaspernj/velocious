// @ts-check

/**
 * @typedef {(id: string) => {default: typeof import("./record/index.js").default}} ModelClassRequireContextIDFunctionType
 * @typedef {ModelClassRequireContextIDFunctionType & {
 *   keys: () => string[],
 *   id: string
 * }} ModelClassRequireContextType
 */

import restArgsError from "../utils/rest-args-error.js"

export default class VelociousDatabaseInitializerFromRequireContext {
  /**
   * @param {object} args
   * @param {ModelClassRequireContextType} args.requireContext
   */
  constructor({requireContext, ...restArgs}) {
    restArgsError(restArgs)

    this.requireContext = requireContext
  }

  /**
   * @param {object} args
   * @param {import("../configuration.js").default} args.configuration
   * @returns {Promise<void>} - Result.
   */
  async initialize({configuration, ...restArgs}) {
    restArgsError(restArgs)

    for (const fileName of this.requireContext.keys()) {
      const modelClassImport = this.requireContext(fileName)

      if (!modelClassImport) throw new Error(`Couldn't import model class from ${fileName}`)

      const modelClass = modelClassImport.default

      if (!modelClass) throw new Error(`Model wasn't exported from: ${fileName}`)

      await modelClass.initializeRecord({configuration})

      if (await modelClass.hasTranslationsTable()) {
        const translationClass = modelClass.getTranslationClass()

        await translationClass.initializeRecord({configuration})
      }
    }
  }
}
