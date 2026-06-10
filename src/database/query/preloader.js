// @ts-check

import BelongsToPreloader from "./preloader/belongs-to.js"
import HasManyPreloader from "./preloader/has-many.js"
import HasOnePreloader from "./preloader/has-one.js"
import PreloaderSelection from "./preloader/selection.js"
import restArgsError from "../../utils/rest-args-error.js"

/**
 * Runs normalize nested preload.
 * @param {import("../query/index.js").NestedPreloadRecord | string | string[] | boolean} preload - Preload data in shorthand or nested form.
 * @returns {import("../query/index.js").NestedPreloadRecord | null} - Normalized nested preload record.
 */
function normalizeNestedPreload(preload) {
  if (!preload || typeof preload == "boolean") return null

  if (typeof preload == "string") {
    return {[preload]: true}
  }

  if (Array.isArray(preload)) {
    /**
 * Result.
 * @type {import("../query/index.js").NestedPreloadRecord} */
    const result = {}

    for (const entry of preload) {
      if (typeof entry == "string") {
        result[entry] = true
        continue
      }

      if (entry && typeof entry == "object") {
        const normalizedEntry = normalizeNestedPreload(entry)

        if (normalizedEntry) {
          for (const [key, value] of Object.entries(normalizedEntry)) {
            result[key] = value
          }
        }
        continue
      }

      throw new Error(`Invalid preload entry type: ${typeof entry}`)
    }

    return result
  }

  if (preload && typeof preload == "object") {
    /**
 * Result.
 * @type {import("../query/index.js").NestedPreloadRecord} */
    const result = {}

    for (const [key, value] of Object.entries(preload)) {
      if (value === true || value === false) {
        result[key] = value
        continue
      }

      const normalizedValue = normalizeNestedPreload(value)

      if (normalizedValue) {
        result[key] = normalizedValue
      } else {
        throw new Error(`Invalid preload value for ${key}: ${typeof value}`)
      }
    }

    return result
  }

  throw new Error(`Invalid preload type: ${typeof preload}`)
}

export default class VelociousDatabaseQueryPreloader {
  /**
   * Preloads relationship(s) onto one or more already-loaded model instances.
   * Accepts either a query built via `Model.preload(...).select(...)` (its
   * preload graph and selects are used) or a raw preload spec
   * (string / array / nested object).
   * @param {Array<import("../record/index.js").default>} models - Model instances to preload onto.
   * @param {import("./model-class-query.js").default | import("./index.js").NestedPreloadRecord | string | Array<string | import("./index.js").NestedPreloadRecord>} queryOrSpec - Preload source.
   * @param {{force?: boolean}} [options] - Options.
   * @returns {Promise<void>} - Resolves when preloading completes.
   */
  static async preload(models, queryOrSpec, {force = false} = {}) {
    if (models.length == 0) return

    const modelClass = /**
 * Documents this API.
 * @type {typeof import("../record/index.js").default} */ (models[0].constructor)
    const isQuery = Boolean(queryOrSpec) && typeof queryOrSpec == "object" && "_preload" in queryOrSpec
    // Reuse the query builder's preload/select normalization for raw specs
    // instead of duplicating it here.
    const query = isQuery
      ? /**
 * Documents this API.
 * @type {import("./model-class-query.js").default} */ (queryOrSpec)
      : modelClass.preload(/**
 * Documents this API.
 * @type {?} */ (queryOrSpec))

    const preloader = new VelociousDatabaseQueryPreloader({
      modelClass,
      models,
      preload: query._preload,
      selection: new PreloaderSelection({
        preloadSelects: query._preloadSelects,
        preloadSelectsExtra: query._preloadSelectsExtra,
        force
      })
    })

    await preloader.run()
  }

  /**
 * Runs constructor.
   * @param {object} args - Options object.
   * @param {typeof import("../record/index.js").default} args.modelClass - Model class.
   * @param {import("../record/index.js").default[]} args.models - Model instances.
   * @param {import("../query/index.js").NestedPreloadRecord} args.preload - Preload.
   * @param {Record<string, string[]>} [args.preloadSelects] - Narrowing selects keyed by target model name.
   * @param {Record<string, string[]>} [args.preloadSelectsExtra] - Extra selects keyed by target model name.
   * @param {PreloaderSelection} [args.selection] - Pre-built selection (takes precedence over the select maps when given).
   */
  constructor({modelClass, models, preload, preloadSelects = {}, preloadSelectsExtra = {}, selection, ...restArgs}) {
    restArgsError(restArgs)

    this.modelClass = modelClass
    this.models = models
    this.preload = preload
    this.selection = selection || new PreloaderSelection({preloadSelects, preloadSelectsExtra})
  }

  async run() {
    for (const preloadRelationshipName in this.preload) {
      const relationship = this.modelClass.getRelationshipByName(preloadRelationshipName)
      let preloadResult

      if (relationship.getType() == "belongsTo") {
        const belongsToRelationship = /**
 * Documents this API.
 * @type {import("../record/relationships/belongs-to.js").default} */ (relationship)
        const hasManyPreloader = new BelongsToPreloader({models: this.models, relationship: belongsToRelationship, selection: this.selection})

        preloadResult = await hasManyPreloader.run()
      } else if (relationship.getType() == "hasMany") {
        const hasManyRelationship = /**
 * Documents this API.
 * @type {import("../record/relationships/has-many.js").default} */ (relationship)
        const hasManyPreloader = new HasManyPreloader({models: this.models, relationship: hasManyRelationship, selection: this.selection})

        preloadResult = await hasManyPreloader.run()
      } else if (relationship.getType() == "hasOne") {
        const hasOneRelationship = /**
 * Documents this API.
 * @type {import("../record/relationships/has-one.js").default} */ (relationship)
        const hasOnePreloader = new HasOnePreloader({models: this.models, relationship: hasOneRelationship, selection: this.selection})

        preloadResult = await hasOnePreloader.run()
      } else {
        throw new Error(`Unknown relationship type: ${relationship.getType()}`)
      }

      const targetModels = Array.isArray(preloadResult) ? preloadResult : (preloadResult?.targetModels || [])
      const targetModelsByClassName = Array.isArray(preloadResult) ? undefined : preloadResult?.targetModelsByClassName

      // Handle any further preloads in the tree
      const newPreload = this.preload[preloadRelationshipName]
      const normalizedPreload = normalizeNestedPreload(newPreload)

      if (normalizedPreload && targetModels.length > 0) {
        if (relationship.getPolymorphic() && targetModelsByClassName) {
          const configuration = relationship.getConfiguration()

          for (const className in targetModelsByClassName) {
            const models = targetModelsByClassName[className]

            if (models.length == 0) continue

            const targetModelClass = configuration.getModelClass(className)
            const preloader = new VelociousDatabaseQueryPreloader({modelClass: targetModelClass, models, preload: normalizedPreload, selection: this.selection})

            await preloader.run()
          }
        } else {
          const targetModelClass = relationship.getTargetModelClass()

          if (!targetModelClass) throw new Error("No target model class could be gotten from relationship")

          const preloader = new VelociousDatabaseQueryPreloader({modelClass: targetModelClass, models: targetModels, preload: normalizedPreload, selection: this.selection})

          await preloader.run()
        }
      }
    }
  }
}
