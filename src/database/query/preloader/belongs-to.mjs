import * as inflection from "inflection"
import restArgsError from "../../../utils/rest-args-error.mjs"

export default class VelociousDatabaseQueryPreloaderBelongsTo {
  constructor({models, relationship, ...restArgs}) {
    restArgsError(restArgs)

    this.models = models
    this.relationship = relationship
  }

  async run() {
    const foreignKeyValues = []
    const modelsById = {}
    const foreignKey = this.relationship.getForeignKey()
    const foreignKeyCamelized = inflection.camelize(foreignKey, true)
    const preloadCollections = {}

    for (const model of this.models) {
      const foreignKeyValue = model[foreignKeyCamelized]()

      preloadCollections[model.id()] = []
      foreignKeyValues.push(foreignKeyValue)
      modelsById[model.id()] = model
    }

    const whereArgs = {}
    const primaryKey = this.relationship.getPrimaryKey()

    whereArgs[primaryKey] = foreignKeyValues

    // Load target models to be preloaded on the given models
    const targetModels = await this.relationship.getTargetModelClass().where(whereArgs).toArray()
    const targetModelsById = {}

    for (const targetModel of targetModels) {
      targetModelsById[targetModel.id()] = targetModel
    }

    // Set the target preloaded models on the given models
    for (const model of this.models) {
      const foreignKeyValue = model[foreignKeyCamelized]()
      const targetModel = targetModelsById[foreignKeyValue]
      const modelRelationship = model.getRelationshipByName(this.relationship.getRelationshipName())

      modelRelationship.setPreloaded(true)
      modelRelationship.setLoaded(targetModel)
    }

    return targetModels
  }
}
