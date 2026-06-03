// @ts-check

/**
 * Preloads relationships onto already-loaded frontend model instances.
 *
 * Unlike the backend ORM preloader (which queries relationship tables
 * directly), the frontend re-fetches the parent records through their
 * `index` endpoint with the preload/select params, then copies the resulting
 * top-level preloaded relationships onto the existing instances. Relationships
 * that are already preloaded with the required columns present are skipped,
 * so repeated calls reuse the relationship cache instead of issuing duplicate
 * requests.
 */
export default class FrontendModelPreloader {
  /**
   * @param {Array<import("./base.js").default>} models - Frontend model instances to preload onto.
   * @param {import("./query.js").default<any> | import("../database/query/index.js").NestedPreloadRecord | string | Array<string | import("../database/query/index.js").NestedPreloadRecord>} queryOrSpec - A query built via `Model.preload(...).select(...)`, or a raw preload spec.
   * @param {{force?: boolean}} [options] - Options.
   * @returns {Promise<void>} - Resolves when preloading completes.
   */
  static async preload(models, queryOrSpec, {force = false} = {}) {
    if (!models || models.length === 0) return

    const modelClass = /** @type {typeof import("./base.js").default} */ (models[0].constructor)
    const isQuery = Boolean(queryOrSpec) && typeof queryOrSpec === "object" && "_preload" in queryOrSpec
    const query = isQuery
      ? /** @type {import("./query.js").default<any>} */ (queryOrSpec)
      : modelClass.preload(/** @type {any} */ (queryOrSpec))

    const topLevelRelationships = Object.keys(query._preload)

    if (topLevelRelationships.length === 0) return

    const modelsToLoad = models.filter((model) => this._modelNeedsReload({modelClass, model, topLevelRelationships, query, force}))

    if (modelsToLoad.length === 0) return

    const primaryKey = modelClass.primaryKey()
    const ids = modelsToLoad.map((model) => model.primaryKeyValue())

    // Rebuild a fresh query carrying only the projection-relevant state so a
    // user-supplied limit/sort/where on the source query doesn't leak in.
    const reloadQuery = modelClass.preload(query._preload)

    reloadQuery._select = query._select
    reloadQuery._selectsExtra = query._selectsExtra
    reloadQuery._withCount = query._withCount
    reloadQuery._abilities = query._abilities
    reloadQuery._queryData = query._queryData
    reloadQuery.where({[primaryKey]: ids})

    const reloaded = await reloadQuery.toArray()

    /** @type {Map<string, import("./base.js").default>} */
    const reloadedById = new Map()

    for (const reloadedModel of reloaded) {
      reloadedById.set(String(reloadedModel.primaryKeyValue()), reloadedModel)
    }

    for (const model of modelsToLoad) {
      const reloadedModel = reloadedById.get(String(model.primaryKeyValue()))

      // The record may have been deleted/filtered between the original load and
      // this preload — skip it rather than crashing on a missing reload.
      if (!reloadedModel) continue

      for (const relationshipName of topLevelRelationships) {
        const value = reloadedModel.getRelationshipByName(relationshipName).loaded()

        model.getRelationshipByName(relationshipName).setLoaded(value)
      }
    }
  }

  /**
   * @param {object} args - Options object.
   * @param {typeof import("./base.js").default} args.modelClass - Root model class.
   * @param {import("./base.js").default} args.model - Model instance.
   * @param {string[]} args.topLevelRelationships - Relationship names to preload.
   * @param {import("./query.js").default<any>} args.query - Source query carrying select/selectsExtra.
   * @param {boolean} args.force - Whether to reload regardless of cached state.
   * @returns {boolean} - Whether the model needs a reload request.
   */
  static _modelNeedsReload({modelClass, model, topLevelRelationships, query, force}) {
    if (force) return true

    for (const relationshipName of topLevelRelationships) {
      if (!this._relationshipSatisfied({modelClass, model, relationshipName, query})) return true
    }

    return false
  }

  /**
   * A relationship is satisfied when it is already preloaded and every required
   * attribute (from `select`/`selectsExtra` for the target model) is present on
   * each loaded target. With no select, being preloaded is enough.
   * @param {object} args - Options object.
   * @param {typeof import("./base.js").default} args.modelClass - Root model class.
   * @param {import("./base.js").default} args.model - Model instance.
   * @param {string} args.relationshipName - Relationship name.
   * @param {import("./query.js").default<any>} args.query - Source query carrying select/selectsExtra.
   * @returns {boolean} - Whether the relationship is already satisfied.
   */
  static _relationshipSatisfied({modelClass, model, relationshipName, query}) {
    const relationship = model.getRelationshipByName(relationshipName)

    if (!relationship.getPreloaded()) return false

    const required = this._requiredAttributesFor({modelClass, relationshipName, query})

    if (required.length === 0) return true

    const loaded = relationship.loaded()
    const targets = loaded == null ? [] : (Array.isArray(loaded) ? loaded : [loaded])

    for (const target of targets) {
      for (const attributeName of required) {
        if (!target.hasLoadedAttribute(attributeName)) return false
      }
    }

    return true
  }

  /**
   * @param {object} args - Options object.
   * @param {typeof import("./base.js").default} args.modelClass - Root model class.
   * @param {string} args.relationshipName - Relationship name.
   * @param {import("./query.js").default<any>} args.query - Source query carrying select/selectsExtra.
   * @returns {string[]} - Attribute names that must be present for the relationship to count as satisfied.
   */
  static _requiredAttributesFor({modelClass, relationshipName, query}) {
    const targetModelClass = modelClass.relationshipModelClass(relationshipName)

    if (!targetModelClass) return []

    const targetModelName = targetModelClass.getModelName()

    return query._select[targetModelName] || query._selectsExtra[targetModelName] || []
  }
}
