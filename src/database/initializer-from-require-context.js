// @ts-check

/**
 * @typedef {(id: string) => {default: typeof import("./record/index.js").default}} ModelClassRequireContextIDFunctionType
 * @typedef {ModelClassRequireContextIDFunctionType & {
 *   keys: () => string[],
 *   id: string
 * }} ModelClassRequireContextType
 */

import Logger from "../logger.js"
import restArgsError from "../utils/rest-args-error.js"

export default class VelociousDatabaseInitializerFromRequireContext {
  /**
   * @param {object} args - Options object.
   * @param {ModelClassRequireContextType} args.requireContext - Require context.
   */
  constructor({requireContext, ...restArgs}) {
    restArgsError(restArgs)

    this.requireContext = requireContext
    this.logger = new Logger(this)
  }

  /**
   * @param {object} args - Options object.
   * @param {import("../configuration.js").default} args.configuration - Configuration instance.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async initialize({configuration, ...restArgs}) {
    restArgsError(restArgs)

    for (const fileName of this.requireContext.keys()) {
      const modelClassImport = this.requireContext(fileName)

      if (!modelClassImport) throw new Error(`Couldn't import model class from ${fileName}`)

      const modelClass = modelClassImport.default

      if (!modelClass) throw new Error(`Model wasn't exported from: ${fileName}`)

      if (!modelClass.getEagerLoadRecordMetadata()) {
        modelClass.registerRecordClass({configuration})
        await this._bestEffortInitializeDeferredModel({configuration, modelClass})
        continue
      }

      await this._initializeModelRecord({configuration, modelClass})
    }
  }

  /**
   * Initializes a model's record metadata and its translation table (if any).
   * @param {object} args - Options object.
   * @param {import("../configuration.js").default} args.configuration - Configuration instance.
   * @param {typeof import("./record/index.js").default} args.modelClass - Model class to initialize.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _initializeModelRecord({configuration, modelClass}) {
    await modelClass.initializeRecord({configuration})

    if (await modelClass.hasTranslationsTable()) {
      await modelClass.getTranslationClass().initializeRecord({configuration})
    }
  }

  /**
   * Models opting out of eager metadata loading (`setEagerLoadRecordMetadata(false)`)
   * are still initialized at startup when their (optional) table is present, so that
   * synchronous query building such as `.where(...)` works without callers having to
   * call `ensureInitialized()` first. When the table — or its connection — is not
   * available the model is left deferred so startup still succeeds; it can then
   * initialize lazily the first time a terminal query method (find/create/etc.) runs.
   * @param {object} args - Options object.
   * @param {import("../configuration.js").default} args.configuration - Configuration instance.
   * @param {typeof import("./record/index.js").default} args.modelClass - Model class to initialize.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async _bestEffortInitializeDeferredModel({configuration, modelClass}) {
    try {
      const connection = modelClass.connection({enforceTenantDatabaseScope: false})
      const table = await connection.getTableByName(modelClass.tableName(), {throwError: false})

      if (!table) return

      await this._initializeModelRecord({configuration, modelClass})
    } catch (error) {
      // The optional table - or, for a translated model, its <table>_translations
      // table (initializeRecord -> _defineTranslationMethods initializes the
      // translation class) - is missing, or its connection is unavailable. Re-register
      // to drop any partial metadata and leave the model deferred so startup still
      // succeeds; it initializes lazily on first terminal use.
      this.logger.debug(`Leaving ${modelClass.name} deferred - table metadata unavailable at startup`, error)
      modelClass.registerRecordClass({configuration})
    }
  }
}
