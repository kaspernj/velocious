import restArgsError from "../../../utils/rest-args-error.js"

export default class VelociousDatabaseQueryPreloaderHasOne {
  constructor({models, relationship, ...restArgs}) {
    restArgsError(restArgs)

    this.models = models
    this.relationship = relationship
  }

  async run() {
    const modelsPrimaryKeyValues = []
    const modelsByPrimaryKeyValue = {}
    const foreignKey = this.relationship.getForeignKey()
    const primaryKey = this.relationship.getPrimaryKey()
    const preloadCollections = {}

    for (const model of this.models) {
      const primaryKeyValue = model.readColumn(primaryKey)

      preloadCollections[primaryKeyValue] = null

      if (!modelsPrimaryKeyValues.includes(primaryKeyValue)) modelsPrimaryKeyValues.push(primaryKeyValue)
      if (!(primaryKeyValue in modelsByPrimaryKeyValue)) modelsByPrimaryKeyValue[primaryKeyValue] = []

      modelsByPrimaryKeyValue[primaryKeyValue].push(model)
    }

    const whereArgs = {}

    whereArgs[foreignKey] = modelsPrimaryKeyValues

    // Load target models to be preloaded on the given models
    const targetModels = await this.relationship.getTargetModelClass().where(whereArgs).toArray()

    for (const targetModel of targetModels) {
      const foreignKeyValue = targetModel.readColumn(foreignKey)

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
