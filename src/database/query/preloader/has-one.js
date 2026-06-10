// @ts-check

import ensureModelClassInitialized from "./ensure-model-class-initialized.js"
import PreloaderSelection from "./selection.js"
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
      @type {Array<number | string>} */
    const modelsPrimaryKeyValues = []

    /**
     * Models by primary key value.
      @type {Record<number | string, Array<import("../../record/index.js").default>>} */
    const modelsByPrimaryKeyValue = {}

    const foreignKey = this.relationship.getForeignKey()
    const primaryKey = this.relationship.getPrimaryKey()
    const relationshipName = this.relationship.getRelationshipName()

    const targetModelClass = this.relationship.getTargetModelClass()

    if (!targetModelClass) throw new Error("No target model class could be gotten from relationship")

    /**
     * Preload collections.
      @type {Record<number | string, import("../../record/index.js").default | undefined>} */
    const preloadCollections = {}

    /**
     * Satisfied targets.
      @type {import("../../record/index.js").default[]} */
    const satisfiedTargets = []

    for (const model of this.models) {
      const instanceRelationship = model.getRelationshipByName(relationshipName)

      if (this.selection.isSatisfied({instanceRelationship, targetModelClass, mappingColumns: [foreignKey]})) {
        const loaded = /**
                        * Narrows the runtime value to the documented type.
                         @type {import("../../record/index.js").default | undefined} */ (instanceRelationship.getLoadedOrUndefined())

        if (loaded) satisfiedTargets.push(loaded)
        continue
      }

      const primaryKeyValue = /**
                               * Narrows the runtime value to the documented type.
                                @type {string | number} */ (model.readColumn(primaryKey))

      preloadCollections[primaryKeyValue] = undefined

      if (!modelsPrimaryKeyValues.includes(primaryKeyValue)) modelsPrimaryKeyValues.push(primaryKeyValue)
      if (!(primaryKeyValue in modelsByPrimaryKeyValue)) modelsByPrimaryKeyValue[primaryKeyValue] = []

      modelsByPrimaryKeyValue[primaryKeyValue].push(model)
    }

    if (modelsPrimaryKeyValues.length == 0) return satisfiedTargets

    /**
     * Where args.
      @type {Record<string, string | number | Array<string | number>>} */
    const whereArgs = {}

    whereArgs[foreignKey] = modelsPrimaryKeyValues

    if (this.relationship.getPolymorphic()) {
      const typeColumn = this.relationship.getPolymorphicTypeColumn()

      whereArgs[typeColumn] = this.relationship.getModelClass().getModelName()
    }

    await ensureModelClassInitialized(targetModelClass, this.relationship.getConfiguration())

    // Load target models to be preloaded on the given models
    let query = targetModelClass.where(whereArgs)

    query = this.relationship.applyScope(query)
    query = this.selection.applyToQuery({query, targetModelClass, mappingColumns: [foreignKey]})

    const targetModels = await query.toArray()

    for (const targetModel of targetModels) {
      const foreignKeyValue = /**
                               * Narrows the runtime value to the documented type.
                                @type {string | number} */ (targetModel.readColumn(foreignKey))

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
