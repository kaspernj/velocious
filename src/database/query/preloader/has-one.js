import * as inflection from "inflection"
import restArgsError from "../../../utils/rest-args-error.js"

export default class VelociousDatabaseQueryPreloaderHasOne {
  constructor({models, relationship, ...restArgs}) {
    restArgsError(restArgs)

    this.models = models
    this.relationship = relationship
  }

  async run() {
    const modelIds = []
    const modelsById = {}
    const foreignKey = this.relationship.getForeignKey()
    const foreignKeyCamelized = inflection.camelize(foreignKey, true)
    const preloadCollections = {}

    for (const model of this.models) {
      preloadCollections[model.id()] = []
      modelIds.push(model.id())

      if (!(model.id in modelsById)) modelsById[model.id()] = []

      modelsById[model.id()].push(model)
    }

    const whereArgs = {}

    whereArgs[foreignKey] = modelIds

    // Load target models to be preloaded on the given models
    const targetModels = await this.relationship.getTargetModelClass().where(whereArgs).toArray()

    for (const targetModel of targetModels) {
      const foreignKeyValue = targetModel[foreignKeyCamelized]()

      preloadCollections[foreignKeyValue] = targetModel
    }

    // Set the target preloaded models on the given models
    for (const modelId in preloadCollections) {
      const preloadedModel = preloadCollections[modelId]

      for (const model of modelsById[modelId]) {
        const modelRelationship = model.getRelationshipByName(this.relationship.getRelationshipName())

        modelRelationship.setPreloaded(true)
        modelRelationship.setLoaded(preloadedModel)
      }
    }

    return targetModels
  }
}
