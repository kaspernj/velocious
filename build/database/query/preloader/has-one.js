// @ts-check

import ensureModelClassInitialized from "./ensure-model-class-initialized.js"
import PreloaderSelection from "./selection.js"
import preloadQueryForModel, { bindPreloadModelClass } from "./query-for-model.js"
import restArgsError from "../../../utils/rest-args-error.js"

export default class VelociousDatabaseQueryPreloaderHasOne {
  /**
   * Runs constructor.
   * @param {object} args - Options object.
   * @param {Array<import("../../record/index.js").default>} args.models - Model instances.
   * @param {import("../../record/relationships/has-one.js").default} args.relationship - Relationship.
   * @param {PreloaderSelection} [args.selection] - Column selection and idempotency rules.
   */
  constructor({models, relationship, selection, ...restArgs}) {
    restArgsError(restArgs)

    this.models = models
    this.relationship = relationship
    this.selection = selection || new PreloaderSelection()
  }

  async run() {
    /**
     * Models primary key values.
     * @type {Set<number | string>} */
    const modelsPrimaryKeyValues = new Set()

    /**
     * Models by primary key value.
     * @type {Record<number | string, Array<import("../../record/index.js").default>>} */
    const modelsByPrimaryKeyValue = {}

    const primaryKey = this.relationship.getPrimaryKey()
    const relationshipName = this.relationship.getRelationshipName()

    const rawTargetModelClass = this.relationship.getTargetModelClass()

    if (!rawTargetModelClass) throw new Error("No target model class could be gotten from relationship")

    const sourceModelClass = this.models[0].getModelClass()
    const targetModelClass = bindPreloadModelClass(this.models, rawTargetModelClass)
    const foreignKey = this.relationship.getForeignKeyForModelClasses({modelClass: sourceModelClass, targetModelClass})

    /**
     * Preload collections.
     * @type {Record<number | string, import("../../record/index.js").default | undefined>} */
    const preloadCollections = {}

    /**
     * Satisfied targets.
     * @type {import("../../record/index.js").default[]} */
    const satisfiedTargets = []

    for (const model of this.models) {
      const instanceRelationship = model.getRelationshipByName(relationshipName)

      if (this.selection.isSatisfied({instanceRelationship, targetModelClass, mappingColumns: [foreignKey]})) {
        const loaded = /** @type {import("../../record/index.js").default | undefined} */ (instanceRelationship.getLoadedOrUndefined())

        if (loaded) satisfiedTargets.push(loaded)
        continue
      }

      const primaryKeyValue = /** @type {string | number} */ (model.readColumn(primaryKey))

      preloadCollections[primaryKeyValue] = undefined

      modelsPrimaryKeyValues.add(primaryKeyValue)
      if (!(primaryKeyValue in modelsByPrimaryKeyValue)) modelsByPrimaryKeyValue[primaryKeyValue] = []

      modelsByPrimaryKeyValue[primaryKeyValue].push(model)
    }

    if (modelsPrimaryKeyValues.size == 0) return satisfiedTargets

    await ensureModelClassInitialized(targetModelClass, this.relationship.getConfiguration(), this.models[0])

    // Load target models to be preloaded on the given models.
    // Build the query once with the polymorphic type constant (when present),
    // relationship scope, and selection. The parent ID IN-list is cloned per cohort
    // so the generated SQL stays within driver limits.
    let baseQuery = preloadQueryForModel(this.models, targetModelClass)

    if (this.relationship.getPolymorphic()) {
      const typeColumn = this.relationship.getPolymorphicTypeColumn()

      baseQuery = baseQuery.where({[typeColumn]: this.relationship.getModelClass().getModelName()})
    }

    baseQuery = this.relationship.applyScope(baseQuery)
    baseQuery = this.selection.applyToQuery({query: baseQuery, targetModelClass, mappingColumns: [foreignKey]})

    /**
     * Target models.
     * @type {import("../../record/index.js").default[]} */
    const targetModels = []
    const driver = baseQuery.driver
    const cohorts = driver.chunkValues([...modelsPrimaryKeyValues], (chunk) => baseQuery.clone().where({[foreignKey]: chunk}).toSql())

    for (const cohort of cohorts) {
      const cohortQuery = baseQuery.clone().where({[foreignKey]: cohort})
      const foundTargetModels = await cohortQuery.toArray()

      targetModels.push(...foundTargetModels)
    }

    for (const targetModel of targetModels) {
      const foreignKeyValue = /** @type {string | number} */ (targetModel.readColumn(foreignKey))

      preloadCollections[foreignKeyValue] = targetModel
    }

    // Set the target preloaded models on the given models
    for (const modelValue in preloadCollections) {
      const preloadedModel = preloadCollections[modelValue]

      for (const model of modelsByPrimaryKeyValue[modelValue]) {
        const modelRelationship = model.getRelationshipByName(relationshipName)

        modelRelationship.setPreloaded(true)
        modelRelationship.setLoaded(preloadedModel)
      }
    }

    return [...satisfiedTargets, ...targetModels]
  }
}
