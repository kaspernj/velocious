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
    const targetForeignKey = this.relationship.getForeignKey()
    const targetTable = targetModelClass.tableName()
    const throughTable = throughModelClass.tableName()
    const driver = targetModelClass.connection()

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

    const quotedIds = modelsPrimaryKeyValues.map((id) => driver.options().quote(id)).join(", ")
    const joinSql = `LEFT JOIN ${driver.quoteTable(throughTable)} ON ${driver.quoteTable(throughTable)}.${driver.quoteColumn(throughPrimaryKey)} = ${driver.quoteTable(targetTable)}.${driver.quoteColumn(targetForeignKey)}`
    const whereSql = `${driver.quoteTable(throughTable)}.${driver.quoteColumn(throughForeignKey)} IN (${quotedIds})`

    let query = targetModelClass.joins(joinSql).where(whereSql)

    // Select the through foreign key so we can map targets back to parents
    query = query.select(`${driver.quoteTable(throughTable)}.${driver.quoteColumn(throughForeignKey)} AS _through_foreign_key`)
    query = this.relationship.applyScope(query)

    const targetModels = await query.toArray()

    for (const targetModel of targetModels) {
      const throughForeignKeyValue = /** @type {string | number} */ (targetModel.readColumn("_through_foreign_key") || targetModel.readAttribute("_through_foreign_key"))

      if (throughForeignKeyValue in preloadCollections) {
        preloadCollections[throughForeignKeyValue].push(targetModel)
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
