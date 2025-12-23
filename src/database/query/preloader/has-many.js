// @ts-check

import restArgsError from "../../../utils/rest-args-error.js"

export default class VelociousDatabaseQueryPreloaderHasMany {
  /**
   * @param {object} args
   * @param {import("../../record/index.js").default[]} args.models
   * @param {import("../../record/relationships/has-many.js").default} args.relationship
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

    /** @type {Record<number | string, Array<import("../../record/index.js").default>>} */
    const preloadCollections = {}

    if (!primaryKey) {
      throw new Error(`${this.relationship.getModelClass().name}#${this.relationship.getRelationshipName()} doesn't have a primary key`)
    }

    for (const model of this.models) {
      const primaryKeyValue = model.readColumn(primaryKey)

      preloadCollections[primaryKeyValue] = []

      if (!modelsPrimaryKeyValues.includes(primaryKeyValue)) modelsPrimaryKeyValues.push(primaryKeyValue)
      if (!(primaryKeyValue in modelsByPrimaryKeyValue)) modelsByPrimaryKeyValue[primaryKeyValue] = []

      modelsByPrimaryKeyValue[primaryKeyValue].push(model)
    }

    /** @type {Record<string, any>} */
    const whereArgs = {}

    whereArgs[foreignKey] = modelsPrimaryKeyValues

    if (this.relationship.getPolymorphic()) {
      const typeColumn = this.relationship.getPolymorphicTypeColumn()

      whereArgs[typeColumn] = this.relationship.getModelClass().name
    }

    const targetModelClass = this.relationship.getTargetModelClass()

    if (!targetModelClass) throw new Error("No target model class could be gotten from relationship")

    // Load target models to be preloaded on the given models
    const targetModels = await targetModelClass.where(whereArgs).toArray()

    for (const targetModel of targetModels) {
      const foreignKeyValue = targetModel.readColumn(foreignKey)

      preloadCollections[foreignKeyValue].push(targetModel)
    }

    // Set the target preloaded models on the given models
    for (const modelValue in preloadCollections) {
      const preloadedCollection = preloadCollections[modelValue]

      for (const model of modelsByPrimaryKeyValue[modelValue]) {
        const modelRelationship = model.getRelationshipByName(this.relationship.getRelationshipName())

        if (preloadedCollection.length == 0) {
          modelRelationship.setLoaded([])
        } else {
          modelRelationship.addToLoaded(preloadedCollection)
        }

        modelRelationship.setPreloaded(true)
      }
    }

    return targetModels
  }
}
