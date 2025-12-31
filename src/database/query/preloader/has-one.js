// @ts-check

import restArgsError from "../../../utils/rest-args-error.js"

export default class VelociousDatabaseQueryPreloaderHasOne {
  /**
   * @param {object} args - Options object.
   * @param {Array<import("../../record/index.js").default>} args.models - Model instances.
   * @param {import("../../record/relationships/has-one.js").default} args.relationship - Relationship.
   */
  constructor({models, relationship, ...restArgs}) {
    restArgsError(restArgs)

    this.models = models
    this.relationship = relationship
  }

  async run() {
    /** @type {Array<number | string>} */
    const modelsPrimaryKeyValues = []

    /** @type {Record<number | string, Array<import("../../record/index.js").default>>} */
    const modelsByPrimaryKeyValue = {}

    const foreignKey = this.relationship.getForeignKey()
    const primaryKey = this.relationship.getPrimaryKey()

    /** @type {Record<number | string, import("../../record/index.js").default | undefined>} */
    const preloadCollections = {}

    for (const model of this.models) {
      const primaryKeyValue = /** @type {string | number} */ (model.readColumn(primaryKey))

      preloadCollections[primaryKeyValue] = undefined

      if (!modelsPrimaryKeyValues.includes(primaryKeyValue)) modelsPrimaryKeyValues.push(primaryKeyValue)
      if (!(primaryKeyValue in modelsByPrimaryKeyValue)) modelsByPrimaryKeyValue[primaryKeyValue] = []

      modelsByPrimaryKeyValue[primaryKeyValue].push(model)
    }

    /** @type {Record<string, string | number | Array<string | number>>} */
    const whereArgs = {}

    whereArgs[foreignKey] = modelsPrimaryKeyValues

    if (this.relationship.getPolymorphic()) {
      const typeColumn = this.relationship.getPolymorphicTypeColumn()

      whereArgs[typeColumn] = this.relationship.getModelClass().name
    }

    const targetModelClass = this.relationship.getTargetModelClass()

    if (!targetModelClass) throw new Error("No target model class could be gotten from relationship")

    // Load target models to be preloaded on the given models
    let query = targetModelClass.where(whereArgs)

    query = this.relationship.applyScope(query)

    const targetModels = await query.toArray()

    for (const targetModel of targetModels) {
      const foreignKeyValue = /** @type {string | number} */ (targetModel.readColumn(foreignKey))

      preloadCollections[foreignKeyValue] = targetModel
    }

    // Set the target preloaded models on the given models
    for (const modelValue in preloadCollections) {
      const preloadedModel = preloadCollections[modelValue]

      for (const model of modelsByPrimaryKeyValue[modelValue]) {
        const modelRelationship = model.getRelationshipByName(this.relationship.getRelationshipName())

        modelRelationship.setPreloaded(true)
        modelRelationship.setLoaded(preloadedModel)
      }
    }

    return targetModels
  }
}
