// @ts-check

import restArgsError from "../../../utils/rest-args-error.js"

export default class VelociousDatabaseQueryPreloaderBelongsTo {
  /**
   * @param {object} args
   * @param {import("../../record/index.js").default[]} args.models
   * @param {import("../../record/relationships/belongs-to.js").default} args.relationship
   */
  constructor({models, relationship, ...restArgs}) {
    restArgsError(restArgs)

    this.models = models
    this.relationship = relationship
  }

  async run() {
    /** @type {Array<number | string>} */
    const foreignKeyValues = []
    const foreignKey = this.relationship.getForeignKey()

    for (const model of this.models) {
      const foreignKeyValue = model.readColumn(foreignKey)

      if (!foreignKeyValues.includes(foreignKeyValue)) foreignKeyValues.push(foreignKeyValue)
    }

    /** @type {Record<string, any>} */
    const whereArgs = {}
    const primaryKey = this.relationship.getPrimaryKey()

    whereArgs[primaryKey] = foreignKeyValues

    const targetModelClass = this.relationship.getTargetModelClass()

    if (!targetModelClass) throw new Error("No target model class could be gotten from relationship")

    // Load target models to be preloaded on the given models
    const targetModels = await targetModelClass.where(whereArgs).toArray()

    /** @type {Record<string, import("../../record/index.js").default>} */
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
