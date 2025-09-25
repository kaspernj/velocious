import restArgsError from "../../../utils/rest-args-error.js"

export default class VelociousDatabaseQueryPreloaderBelongsTo {
  constructor({models, relationship, ...restArgs}) {
    restArgsError(restArgs)

    this.models = models
    this.relationship = relationship
  }

  async run() {
    const foreignKeyValues = []
    const foreignKey = this.relationship.getForeignKey()

    for (const model of this.models) {
      const foreignKeyValue = model.readColumn(foreignKey)

      if (!foreignKeyValues.includes(foreignKeyValue)) foreignKeyValues.push(foreignKeyValue)
    }

    const whereArgs = {}
    const primaryKey = this.relationship.getPrimaryKey()

    whereArgs[primaryKey] = foreignKeyValues

    // Load target models to be preloaded on the given models
    const targetModels = await this.relationship.getTargetModelClass().where(whereArgs).toArray()
    const targetModelsById = {}

    for (const targetModel of targetModels) {
      const primaryKeyValue = targetModel.readColumn(this.relationship.getPrimaryKey())

      targetModelsById[primaryKeyValue] = targetModel
    }

    // Set the target preloaded models on the given models
    for (const model of this.models) {
      const foreignKeyValue = model.readColumn(foreignKey)
      const targetModel = targetModelsById[foreignKeyValue]
      const modelRelationship = model.getRelationshipByName(this.relationship.getRelationshipName())

      modelRelationship.setPreloaded(true)
      modelRelationship.setLoaded(targetModel)
    }

    return targetModels
  }
}
