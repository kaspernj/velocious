// @ts-check

import restArgsError from "../../../utils/rest-args-error.js"

export default class VelociousDatabaseQueryPreloaderHasMany {
  /**
   * @param {object} args - Options object.
   * @param {import("../../record/index.js").default[]} args.models - Model instances.
   * @param {import("../../record/relationships/has-many.js").default} args.relationship - Relationship.
   */
  constructor({models, relationship, ...restArgs}) {
    restArgsError(restArgs)

    this.models = models
    this.relationship = relationship
  }

  /** @returns {Promise<import("../../record/index.js").default[]>} - Loaded target models. */
  async run() {
    if (this.relationship.through) {
      return await this._runThrough()
    }

    return await this._runDirect()
  }

  /**
   * Preload through a join table (e.g. hasMany("invoiceGroups", {through: "invoiceGroupLinks"})).
   *
   * @returns {Promise<import("../../record/index.js").default[]>} - Loaded target models.
   */
  async _runThrough() {
    const primaryKey = this.relationship.getPrimaryKey()

    if (!primaryKey) {
      throw new Error(`${this.relationship.getModelClass().name}#${this.relationship.getRelationshipName()} doesn't have a primary key`)
    }

    const throughRelationshipName = this.relationship.through
    const parentModelClass = this.relationship.getModelClass()
    const throughRelationship = parentModelClass.getRelationshipByName(throughRelationshipName)
    const throughModelClass = throughRelationship.getTargetModelClass()

    if (!throughModelClass) throw new Error(`Through relationship ${throughRelationshipName} has no target model class`)

    const targetModelClass = this.relationship.getTargetModelClass()

    if (!targetModelClass) throw new Error("No target model class could be gotten from relationship")

    const throughForeignKey = throughRelationship.getForeignKey()
    const throughPrimaryKey = throughRelationship.getPrimaryKey()

    /** @type {Array<number | string>} */
    const modelsPrimaryKeyValues = []

    /** @type {Record<number | string, Array<import("../../record/index.js").default>>} */
    const modelsByPrimaryKeyValue = {}

    /** @type {Record<number | string, Array<import("../../record/index.js").default>>} */
    const preloadCollections = {}

    for (const model of this.models) {
      const primaryKeyValue = /** @type {string | number} */ (model.readColumn(primaryKey))

      preloadCollections[primaryKeyValue] = []

      if (!modelsPrimaryKeyValues.includes(primaryKeyValue)) modelsPrimaryKeyValues.push(primaryKeyValue)
      if (!(primaryKeyValue in modelsByPrimaryKeyValue)) modelsByPrimaryKeyValue[primaryKeyValue] = []

      modelsByPrimaryKeyValue[primaryKeyValue].push(model)
    }

    // Step 1: Query the through table to build parent→target ID mapping
    const throughModels = await throughModelClass
      .where({[throughForeignKey]: modelsPrimaryKeyValues})
      .toArray()

    /** @type {Record<string | number, Array<string | number>>} */
    const parentToTargetIds = {}

    /** @type {Set<string | number>} */
    const allTargetIds = new Set()

    for (const throughModel of throughModels) {
      const parentId = /** @type {string | number} */ (throughModel.readColumn(throughForeignKey))
      const targetId = /** @type {string | number} */ (throughModel.readColumn(throughPrimaryKey))

      if (!(parentId in parentToTargetIds)) parentToTargetIds[parentId] = []

      parentToTargetIds[parentId].push(targetId)
      allTargetIds.add(targetId)
    }

    // Step 2: Load target models by their IDs
    /** @type {import("../../record/index.js").default[]} */
    let targetModels = []

    if (allTargetIds.size > 0) {
      const targetPrimaryKey = targetModelClass.primaryKey()
      let query = targetModelClass.where({[targetPrimaryKey]: [...allTargetIds]})

      query = this.relationship.applyScope(query)
      targetModels = await query.toArray()
    }

    // Step 3: Index target models by their primary key
    /** @type {Record<string | number, import("../../record/index.js").default>} */
    const targetModelsById = {}

    for (const targetModel of targetModels) {
      const targetId = /** @type {string | number} */ (targetModel.readColumn(targetModelClass.primaryKey()))

      targetModelsById[targetId] = targetModel
    }

    // Step 4: Map targets to parents via the through mapping
    for (const parentId in parentToTargetIds) {
      const targetIds = parentToTargetIds[parentId]

      for (const targetId of targetIds) {
        const targetModel = targetModelsById[targetId]

        if (targetModel && parentId in preloadCollections) {
          preloadCollections[parentId].push(targetModel)
        }
      }
    }

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

  /**
   * Preload direct has-many relationships.
   *
   * @returns {Promise<import("../../record/index.js").default[]>} - Loaded target models.
   */
  async _runDirect() {
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
      const primaryKeyValue = /** @type {string | number} */ (model.readColumn(primaryKey))

      preloadCollections[primaryKeyValue] = []

      if (!modelsPrimaryKeyValues.includes(primaryKeyValue)) modelsPrimaryKeyValues.push(primaryKeyValue)
      if (!(primaryKeyValue in modelsByPrimaryKeyValue)) modelsByPrimaryKeyValue[primaryKeyValue] = []

      modelsByPrimaryKeyValue[primaryKeyValue].push(model)
    }

    /** @type {Record<string, string | number | Array<string | number>>} */
    const whereArgs = {}

    whereArgs[foreignKey] = modelsPrimaryKeyValues

    if (this.relationship.getPolymorphic()) {
      const typeColumn = this.relationship.getPolymorphicTypeColumn()

      whereArgs[typeColumn] = this.relationship.getModelClass().getModelName()
    }

    const targetModelClass = this.relationship.getTargetModelClass()

    if (!targetModelClass) throw new Error("No target model class could be gotten from relationship")

    let query = targetModelClass.where(whereArgs)

    query = this.relationship.applyScope(query)

    const targetModels = await query.toArray()

    for (const targetModel of targetModels) {
      const foreignKeyValue = /** @type {string | number} */ (targetModel.readColumn(foreignKey))

      preloadCollections[foreignKeyValue].push(targetModel)
    }

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
