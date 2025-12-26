// @ts-check

import restArgsError from "../../../utils/rest-args-error.js"

export default class VelociousDatabaseQueryPreloaderBelongsTo {
  /**
   * @param {object} args - Options object.
   * @param {import("../../record/index.js").default[]} args.models - Model instances.
   * @param {import("../../record/relationships/belongs-to.js").default} args.relationship - Relationship.
   */
  constructor({models, relationship, ...restArgs}) {
    restArgsError(restArgs)

    this.models = models
    this.relationship = relationship
  }

  async run() {
    const foreignKey = this.relationship.getForeignKey()
    const primaryKey = this.relationship.getPrimaryKey()

    if (this.relationship.getPolymorphic()) {
      const typeColumn = this.relationship.getPolymorphicTypeColumn()
      const configuration = this.relationship.getConfiguration()

      /** @type {{foreignKeyValue: number | string | undefined, model: import("../../record/index.js").default, targetType: string | undefined}[]} */
      const modelMeta = []

      for (const model of this.models) {
        modelMeta.push({
          foreignKeyValue: model.readColumn(foreignKey),
          model,
          targetType: model.readColumn(typeColumn)
        })
      }

      /** @type {Record<string, Array<number | string>>} */
      const foreignKeyValuesByType = {}

      for (const meta of modelMeta) {
        if (meta.targetType === undefined || meta.targetType === null) continue
        if (meta.foreignKeyValue === undefined || meta.foreignKeyValue === null) continue

        if (!foreignKeyValuesByType[meta.targetType]) foreignKeyValuesByType[meta.targetType] = []
        if (!foreignKeyValuesByType[meta.targetType].includes(meta.foreignKeyValue)) foreignKeyValuesByType[meta.targetType].push(meta.foreignKeyValue)
      }

      /** @type {Record<string, Record<number | string, import("../../record/index.js").default>>} */
      const targetModelsByTypeAndId = {}

      /** @type {Record<string, import("../../record/index.js").default[]>} */
      const targetModelsByClassName = {}

      /** @type {import("../../record/index.js").default[]} */
      const targetModels = []

      for (const targetType in foreignKeyValuesByType) {
        const targetModelClass = configuration.getModelClass(targetType)

        /** @type {Record<string, any>} */
        const whereArgs = {}

        whereArgs[primaryKey] = foreignKeyValuesByType[targetType]

        const foundTargetModels = await targetModelClass.where(whereArgs).toArray()

        targetModels.push(...foundTargetModels)
        targetModelsByClassName[targetModelClass.name] = foundTargetModels
        targetModelsByTypeAndId[targetType] = {}

        for (const targetModel of foundTargetModels) {
          const primaryKeyValue = targetModel.readColumn(primaryKey)

          targetModelsByTypeAndId[targetType][primaryKeyValue] = targetModel
        }
      }

      for (const meta of modelMeta) {
        const modelRelationship = meta.model.getRelationshipByName(this.relationship.getRelationshipName())
        const targetModel = meta.targetType ? targetModelsByTypeAndId[meta.targetType]?.[meta.foreignKeyValue] : undefined

        modelRelationship.setPreloaded(true)
        modelRelationship.setLoaded(targetModel)
      }

      return {targetModels, targetModelsByClassName}
    }

    /** @type {Array<number | string>} */
    const foreignKeyValues = []

    for (const model of this.models) {
      const foreignKeyValue = model.readColumn(foreignKey)

      if (!foreignKeyValues.includes(foreignKeyValue)) foreignKeyValues.push(foreignKeyValue)
    }

    /** @type {Record<string, any>} */
    const whereArgs = {}

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
