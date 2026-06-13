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
   * Runs preload.
   * @param {Array<import("./base.js").default>} models - Frontend model instances to preload onto.
   * @param {import("./query.js").default<import("./base.js").FrontendModelClass> | import("../database/query/index.js").NestedPreloadRecord | string | Array<string | import("../database/query/index.js").NestedPreloadRecord>} queryOrSpec - A query built via `Model.preload(...).select(...)`, or a raw preload spec.
   * @param {{force?: boolean}} [options] - Options.
   * @returns {Promise<void>} - Resolves when preloading completes.
   */
  static async preload(models, queryOrSpec, {force = false} = {}) {
    if (!models || models.length === 0) return

    const modelClass = /**
                        * Narrows the runtime value to the documented type.
                         @type {import("./base.js").FrontendModelClass} */ (models[0].constructor)
    const isQuery = Boolean(queryOrSpec) && typeof queryOrSpec === "object" && "_preload" in queryOrSpec
    const query = isQuery
      ? /**
         * Narrows the runtime value to the documented type.
          @type {import("./query.js").default<import("./base.js").FrontendModelClass>} */ (queryOrSpec)
      : modelClass.preload(/**
                            * Narrows the runtime value to the documented type.
                             @type {?} */ (queryOrSpec))

    const topLevelRelationships = Object.keys(query._preload)

    if (topLevelRelationships.length === 0) return

    const modelsToLoad = models.filter((model) => this._modelNeedsReload({modelClass, model, preload: query._preload, query, force}))

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

    /**
     * Reloaded by id.
      @type {Map<string, import("./base.js").default>} */
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
   * Runs model needs reload.
   * @param {object} args - Options object.
   * @param {import("./base.js").FrontendModelClass} args.modelClass - Model class the preload graph is rooted at.
   * @param {import("./base.js").default} args.model - Model instance.
   * @param {import("../database/query/index.js").NestedPreloadRecord} args.preload - Preload sub-graph to satisfy.
   * @param {import("./query.js").default<import("./base.js").FrontendModelClass>} args.query - Source query carrying select/selectsExtra.
   * @param {boolean} args.force - Whether to reload regardless of cached state.
   * @returns {boolean} - Whether the model needs a reload request.
   */
  static _modelNeedsReload({modelClass, model, preload, query, force}) {
    if (force) return true

    for (const relationshipName of Object.keys(preload)) {
      if (!this._relationshipSatisfied({modelClass, model, relationshipName, subPreload: preload[relationshipName], query})) return true
    }

    return false
  }

  /**
   * A relationship is satisfied when it is already preloaded, every required
   * `select` attribute is present on each loaded target, and any nested preload
   * sub-graph is recursively satisfied on those targets. `selectsExtra` can
   * never be proven satisfied from the cache (the backend serializes the
   * client-unknown default attributes plus the extras), so it always reloads.
   * With no select and no nested preload, being preloaded is enough.
   * @param {object} args - Options object.
   * @param {import("./base.js").FrontendModelClass} args.modelClass - Model class owning the relationship.
   * @param {import("./base.js").default} args.model - Model instance.
   * @param {string} args.relationshipName - Relationship name.
   * @param {import("../database/query/index.js").NestedPreloadRecord[string]} args.subPreload - Preload value for this relationship (`true` or a nested record).
   * @param {import("./query.js").default<import("./base.js").FrontendModelClass>} args.query - Source query carrying select/selectsExtra.
   * @returns {boolean} - Whether the relationship is already satisfied.
   */
  static _relationshipSatisfied({modelClass, model, relationshipName, subPreload, query}) {
    const relationship = model.getRelationshipByName(relationshipName)

    if (!relationship.getPreloaded()) return false

    const targetModelClass = modelClass.relationshipModelClass(relationshipName)
    const loaded = relationship.loaded()
    const targets = loaded == null ? [] : (Array.isArray(loaded) ? loaded : [loaded])

    if (targetModelClass) {
      const targetModelName = targetModelClass.getModelName()

      // `selectsExtra` serializes the default attributes (unknown to the client)
      // plus the extras, so a cached target can't be proven complete.
      if (query._selectsExtra[targetModelName]) return false

      const required = query._select[targetModelName] || []

      for (const target of targets) {
        for (const attributeName of required) {
          if (!target.hasLoadedAttribute(attributeName)) return false
        }
      }
    }

    const nestedPreload = this._nestedPreloadRecord(subPreload)

    if (nestedPreload && targetModelClass) {
      for (const target of targets) {
        if (this._modelNeedsReload({modelClass: targetModelClass, model: target, preload: nestedPreload, query, force: false})) {
          return false
        }
      }
    }

    return true
  }

  /**
   * Runs nested preload record.
   * @param {import("../database/query/index.js").NestedPreloadRecord[string]} subPreload - Preload value for a relationship.
   * @returns {import("../database/query/index.js").NestedPreloadRecord | null} - Nested preload record, or null when there is no deeper graph.
   */
  static _nestedPreloadRecord(subPreload) {
    if (!subPreload || typeof subPreload !== "object") return null
    if (Object.keys(subPreload).length === 0) return null

    return /** Narrows the runtime value to the documented type. @type {import("../database/query/index.js").NestedPreloadRecord} */ (subPreload)
  }
}
